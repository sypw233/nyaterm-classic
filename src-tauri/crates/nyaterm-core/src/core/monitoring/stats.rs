use crate::error::{AppError, AppResult};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, OwnedMutexGuard};

const MAX_SAMPLE_WINDOW: Duration = Duration::from_secs(5 * 60);
/// Below this window, scheduler jitter dominates and a rate would be noise.
const MIN_NETWORK_SAMPLE_WINDOW: Duration = Duration::from_millis(100);
const SAMPLE_TTL: Duration = Duration::from_secs(10 * 60);
const DISK_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
/// `who` is comparatively expensive and login sessions change slowly, so the
/// optional user probe runs far less often than the fast counters.
const USERS_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const CPU_USAGE_DIFF_THRESHOLD: f64 = 5.0;
const CPU_TOTAL_GAP_RATIO_THRESHOLD: f64 = 0.02;

#[derive(serde::Serialize, Default, Clone, Debug, PartialEq, Eq)]
pub struct SystemInfo {
    pub hostname: String,
    pub uptime_sec: u64,
    pub os: String,
    pub arch: String,
}

#[derive(serde::Serialize, Default, Clone)]
pub struct LoadInfo {
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
}

#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CpuUsageSource {
    #[default]
    WarmingUp,
    Aggregate,
    CoreWeightedFallback,
}

#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq)]
pub struct CpuCoreUsage {
    pub id: u32,
    pub usage: f64,
}

#[derive(serde::Serialize, Default, Clone)]
pub struct CpuInfo {
    pub model: String,
    pub cores: u32,
    pub usage: Option<f64>,
    pub per_core: Vec<CpuCoreUsage>,
    pub sample_window_ms: Option<u64>,
    pub usage_source: CpuUsageSource,
}

#[derive(serde::Serialize, Default, Clone)]
pub struct MemoryInfo {
    pub used: u64,
    pub available: u64,
    pub cached: u64,
}

#[derive(serde::Serialize, Clone)]
pub struct NetworkInfo {
    pub nic: String,
    pub state: String,
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
    /// Why this sample may not be a fresh, trustworthy rate.
    #[serde(default)]
    pub rate_status: NetworkRateStatus,
}

/// Validity of a network rate sample.
///
/// `WarmingUp` means there is no previous counter to subtract yet, `Available`
/// means the rate is real. The remaining states explain a zero instead of a
/// fabricated spike: a counter that went backwards, a sampling gap longer than
/// the staleness window, or a window too short to divide by.
#[derive(serde::Serialize, Debug, Default, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkRateStatus {
    #[default]
    WarmingUp,
    Available,
    CounterReset,
    Interrupted,
    Unavailable,
}

#[derive(serde::Serialize, Default, Clone)]
pub struct NetworkSummaryInfo {
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
}

/// One account with at least one interactive login session on the host.
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct LoggedInUser {
    pub name: String,
    pub sessions: u32,
}

/// Whether the optional `who` probe ran and produced a trustworthy result.
#[derive(serde::Serialize, Debug, Default, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoggedInUsersStatus {
    /// The probe was not requested for this sample.
    #[default]
    NotCollected,
    /// `who` ran and every record parsed cleanly.
    Available,
    /// `who` is not installed on the host.
    Unavailable,
    /// `who` exists but timed out, failed, or emitted unparsable output.
    Failed,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DiskInfo {
    pub device: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    pub use_percent: u32,
}

#[derive(serde::Serialize, Default, Clone)]
pub struct RemoteStats {
    pub system: SystemInfo,
    pub load: LoadInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub networks: Vec<NetworkInfo>,
    pub network_summary: NetworkSummaryInfo,
    pub disks: Vec<DiskInfo>,
    pub users: Vec<LoggedInUser>,
    pub users_status: LoggedInUsersStatus,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct CpuTicks {
    user: u64,
    nice: u64,
    system: u64,
    idle: u64,
    iowait: u64,
    irq: u64,
    softirq: u64,
    steal: u64,
    guest: u64,
    guest_nice: u64,
}

#[derive(Debug, Clone, Default)]
struct CpuSnapshot {
    uptime_sec: u64,
    aggregate: CpuTicks,
    cores: BTreeMap<u32, CpuTicks>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CpuDelta {
    busy: u64,
    idle: u64,
    total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NetworkCounters {
    rx_bytes: u64,
    tx_bytes: u64,
}

#[derive(Clone)]
pub struct ParsedRemoteStats {
    stats: RemoteStats,
    cpu_snapshot: Option<CpuSnapshot>,
    networks: BTreeMap<String, NetworkCounters>,
    static_info: Option<StaticRemoteStats>,
    disks: Option<Vec<DiskInfo>>,
    disk_probe_attempted: bool,
    users_probe_attempted: bool,
}

#[derive(Debug, Clone)]
struct StaticRemoteStats {
    system: SystemInfo,
    cpu_model: String,
    cpu_cores: u32,
}

#[derive(Debug, Clone)]
struct CachedDisks {
    values: Vec<DiskInfo>,
}

#[derive(Debug, Clone)]
struct CachedRemoteSample {
    static_info: Option<StaticRemoteStats>,
    disks: Option<CachedDisks>,
    disk_attempted_at: Option<Instant>,
    users: Vec<LoggedInUser>,
    users_status: LoggedInUsersStatus,
    users_attempted_at: Option<Instant>,
    cpu_snapshot: Option<CpuSnapshot>,
    networks: BTreeMap<String, NetworkCounters>,
    updated_at: Instant,
}

#[derive(Default)]
pub struct RemoteStatsSampler {
    samples: Mutex<HashMap<String, CachedRemoteSample>>,
    session_states: Mutex<HashMap<String, Arc<SessionProbeState>>>,
}

#[derive(Default)]
struct SessionProbeState {
    lock: Arc<Mutex<()>>,
    invalidated: AtomicBool,
}

pub struct RemoteStatsProbeLease {
    state: Arc<SessionProbeState>,
    _guard: OwnedMutexGuard<()>,
}

impl RemoteStatsProbeLease {
    pub fn is_current(&self) -> bool {
        !self.state.invalidated.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatsProbePlan {
    pub include_static: bool,
    pub include_disk: bool,
    /// Run `who` to collect interactive login sessions. Throttled by
    /// `USERS_REFRESH_INTERVAL` because it costs an extra remote command.
    pub include_users: bool,
}

impl RemoteStatsSampler {
    pub async fn lock_session(&self, session_id: &str) -> RemoteStatsProbeLease {
        let state = {
            let mut states = self.session_states.lock().await;
            states
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(SessionProbeState::default()))
                .clone()
        };
        let guard = state.lock.clone().lock_owned().await;
        RemoteStatsProbeLease {
            state,
            _guard: guard,
        }
    }

    pub async fn probe_plan(&self, session_id: &str) -> StatsProbePlan {
        self.probe_plan_at(session_id, Instant::now()).await
    }

    async fn probe_plan_at(&self, session_id: &str, now: Instant) -> StatsProbePlan {
        let mut samples = self.samples.lock().await;
        prune_stale_samples(&mut samples, now);
        let sample = samples.get(session_id);

        StatsProbePlan {
            include_static: sample
                .and_then(|sample| sample.static_info.as_ref())
                .is_none(),
            include_disk: sample
                .and_then(|sample| sample.disk_attempted_at)
                .is_none_or(|attempted_at| {
                    now.saturating_duration_since(attempted_at) >= DISK_REFRESH_INTERVAL
                }),
            include_users: sample
                .and_then(|sample| sample.users_attempted_at)
                .is_none_or(|attempted_at| {
                    now.saturating_duration_since(attempted_at) >= USERS_REFRESH_INTERVAL
                }),
        }
    }

    #[cfg(test)]
    async fn complete_snapshot(&self, session_id: &str, parsed: ParsedRemoteStats) -> RemoteStats {
        let lease = self.lock_session(session_id).await;
        self.complete_snapshot_with_lease(session_id, &lease, parsed)
            .await
    }

    pub async fn complete_snapshot_with_lease(
        &self,
        session_id: &str,
        lease: &RemoteStatsProbeLease,
        parsed: ParsedRemoteStats,
    ) -> RemoteStats {
        self.complete_snapshot_at(session_id, lease, parsed, Instant::now())
            .await
    }

    async fn complete_snapshot_at(
        &self,
        session_id: &str,
        lease: &RemoteStatsProbeLease,
        parsed: ParsedRemoteStats,
        now: Instant,
    ) -> RemoteStats {
        let mut samples = self.samples.lock().await;
        prune_stale_samples(&mut samples, now);

        let previous = samples.get(session_id).cloned();
        let mut stats = parsed.stats;

        let static_info = parsed.static_info.clone().or_else(|| {
            previous
                .as_ref()
                .and_then(|sample| sample.static_info.clone())
        });
        if let Some(static_info) = static_info.as_ref() {
            let uptime_sec = stats.system.uptime_sec;
            stats.system = static_info.system.clone();
            stats.system.uptime_sec = uptime_sec;
            stats.cpu.model.clone_from(&static_info.cpu_model);
            stats.cpu.cores = static_info.cpu_cores;
        }

        let disks = match parsed.disks {
            Some(values) => Some(CachedDisks { values }),
            None => previous.as_ref().and_then(|sample| sample.disks.clone()),
        };
        let disk_attempted_at = if parsed.disk_probe_attempted {
            Some(now)
        } else {
            previous
                .as_ref()
                .and_then(|sample| sample.disk_attempted_at)
        };
        if let Some(disks) = disks.as_ref() {
            stats.disks.clone_from(&disks.values);
        }

        // Login sessions are refreshed on their own slower cadence. When this
        // sample did not run `who`, keep the previously collected list instead
        // of reporting a spurious empty result.
        let users_attempted_at = if parsed.users_probe_attempted {
            Some(now)
        } else {
            previous
                .as_ref()
                .and_then(|sample| sample.users_attempted_at)
        };
        if stats.users_status == LoggedInUsersStatus::NotCollected {
            if let Some(previous) = previous.as_ref() {
                stats.users.clone_from(&previous.users);
                stats.users_status = previous.users_status;
            }
        }

        if let Some(previous) = previous.as_ref() {
            let sample_window = now.saturating_duration_since(previous.updated_at);
            if let (Some(previous_cpu), Some(current_cpu)) =
                (previous.cpu_snapshot.as_ref(), parsed.cpu_snapshot.as_ref())
            {
                apply_cpu_usage(
                    session_id,
                    sample_window,
                    previous_cpu,
                    current_cpu,
                    &mut stats,
                );
            }

            apply_network_rates(previous, sample_window, &parsed.networks, &mut stats);
        }

        let users = stats.users.clone();
        let users_status = stats.users_status;
        if lease.is_current() {
            samples.insert(
                session_id.to_string(),
                CachedRemoteSample {
                    static_info,
                    disks,
                    disk_attempted_at,
                    users: users.clone(),
                    users_status,
                    users_attempted_at,
                    cpu_snapshot: parsed.cpu_snapshot,
                    networks: parsed.networks,
                    updated_at: now,
                },
            );
        }

        update_network_summary(&mut stats);
        stats
    }

    pub async fn clear_session(&self, session_id: &str) {
        // Invalidate while holding the state map so a same-id replacement cannot be
        // created until the old sample has also been removed.
        let mut states = self.session_states.lock().await;
        if let Some(state) = states.remove(session_id) {
            state.invalidated.store(true, Ordering::Release);
        }
        let mut samples = self.samples.lock().await;
        samples.remove(session_id);
        drop(samples);
        drop(states);
    }
}

fn prune_stale_samples(samples: &mut HashMap<String, CachedRemoteSample>, now: Instant) {
    samples.retain(|_, sample| now.saturating_duration_since(sample.updated_at) <= SAMPLE_TTL);
}

fn apply_cpu_usage(
    session_id: &str,
    sample_window: Duration,
    previous: &CpuSnapshot,
    current: &CpuSnapshot,
    stats: &mut RemoteStats,
) {
    if sample_window > MAX_SAMPLE_WINDOW || current.uptime_sec < previous.uptime_sec {
        return;
    }

    let Some(aggregate_delta) = calculate_delta(&previous.aggregate, &current.aggregate) else {
        return;
    };

    let mut per_core = Vec::new();
    let mut core_busy = 0_u64;
    let mut core_total = 0_u64;

    for (id, current_ticks) in &current.cores {
        let Some(previous_ticks) = previous.cores.get(id) else {
            continue;
        };
        let Some(delta) = calculate_delta(previous_ticks, current_ticks) else {
            continue;
        };

        core_busy = core_busy.saturating_add(delta.busy);
        core_total = core_total.saturating_add(delta.total);
        per_core.push(CpuCoreUsage {
            id: *id,
            usage: usage_percent(delta),
        });
    }

    let aggregate_usage = usage_percent(aggregate_delta);
    let mut selected_usage = aggregate_usage;
    let mut source = CpuUsageSource::Aggregate;

    if core_total > 0 {
        let weighted_core_usage = core_busy as f64 * 100.0 / core_total as f64;
        let usage_difference = (aggregate_usage - weighted_core_usage).abs();
        let total_gap = aggregate_delta.total.abs_diff(core_total);
        let total_gap_ratio = total_gap as f64 / aggregate_delta.total.max(1) as f64;

        if usage_difference > CPU_USAGE_DIFF_THRESHOLD
            || total_gap_ratio > CPU_TOTAL_GAP_RATIO_THRESHOLD
        {
            tracing::warn!(
                session_id = %session_id,
                aggregate_usage,
                weighted_core_usage,
                aggregate_total = aggregate_delta.total,
                core_total,
                usage_difference,
                total_gap_ratio,
                "cpu_sample_inconsistent"
            );
            selected_usage = weighted_core_usage;
            source = CpuUsageSource::CoreWeightedFallback;
        }
    }

    stats.cpu.usage = Some(selected_usage);
    stats.cpu.per_core = per_core;
    stats.cpu.sample_window_ms = u64::try_from(sample_window.as_millis()).ok();
    stats.cpu.usage_source = source;
}

fn apply_network_rates(
    previous: &CachedRemoteSample,
    sample_window: Duration,
    current_networks: &BTreeMap<String, NetworkCounters>,
    stats: &mut RemoteStats,
) {
    let elapsed = sample_window.as_secs_f64();
    // A gap longer than the staleness window means the counters may have rolled
    // over or the host was unreachable; report zeros instead of a spike.
    let interrupted = sample_window > MAX_SAMPLE_WINDOW;
    // Dividing two sub-100ms readings amplifies scheduler jitter into a spike.
    let too_short = sample_window < MIN_NETWORK_SAMPLE_WINDOW;

    for net in &mut stats.networks {
        let Some(current) = current_networks.get(&net.nic) else {
            continue;
        };
        let Some(previous_counters) = previous.networks.get(&net.nic) else {
            net.rx_bytes_per_sec = 0.0;
            net.tx_bytes_per_sec = 0.0;
            net.rate_status = NetworkRateStatus::WarmingUp;
            continue;
        };

        net.rx_bytes_per_sec = 0.0;
        net.tx_bytes_per_sec = 0.0;
        net.rate_status = if interrupted {
            NetworkRateStatus::Interrupted
        } else if too_short || elapsed <= 0.0 {
            NetworkRateStatus::Unavailable
        } else {
            match (
                current.rx_bytes.checked_sub(previous_counters.rx_bytes),
                current.tx_bytes.checked_sub(previous_counters.tx_bytes),
            ) {
                (Some(rx), Some(tx)) => {
                    net.rx_bytes_per_sec = rx as f64 / elapsed;
                    net.tx_bytes_per_sec = tx as f64 / elapsed;
                    NetworkRateStatus::Available
                }
                // A counter that went backwards is not a rate. Zero the pair
                // rather than clamping one side to a misleading value.
                _ => NetworkRateStatus::CounterReset,
            }
        };
    }
}

fn update_network_summary(stats: &mut RemoteStats) {
    stats.network_summary = NetworkSummaryInfo {
        rx_bytes_per_sec: stats.networks.iter().map(|net| net.rx_bytes_per_sec).sum(),
        tx_bytes_per_sec: stats.networks.iter().map(|net| net.tx_bytes_per_sec).sum(),
    };
}

fn calculate_delta(previous: &CpuTicks, current: &CpuTicks) -> Option<CpuDelta> {
    let user = current.user.checked_sub(previous.user)?;
    let nice = current.nice.checked_sub(previous.nice)?;
    let system = current.system.checked_sub(previous.system)?;
    let idle = current.idle.checked_sub(previous.idle)?;
    let iowait = current.iowait.saturating_sub(previous.iowait);
    let irq = current.irq.checked_sub(previous.irq)?;
    let softirq = current.softirq.checked_sub(previous.softirq)?;
    let steal = current.steal.checked_sub(previous.steal)?;

    let busy = user
        .checked_add(nice)?
        .checked_add(system)?
        .checked_add(irq)?
        .checked_add(softirq)?
        .checked_add(steal)?;
    let idle_all = idle.checked_add(iowait)?;
    let total = busy.checked_add(idle_all)?;

    if total == 0 {
        return None;
    }

    Some(CpuDelta {
        busy,
        idle: idle_all,
        total,
    })
}

fn usage_percent(delta: CpuDelta) -> f64 {
    delta.busy as f64 * 100.0 / delta.total as f64
}

pub fn build_stats_script(plan: StatsProbePlan) -> String {
    if !plan.include_static && !plan.include_disk && !plan.include_users {
        return FAST_STATS_SCRIPT.to_string();
    }

    format!(
        "NYATERM_STATIC={} NYATERM_DISK={} NYATERM_USERS={} {SYSINFO_SCRIPT}",
        u8::from(plan.include_static),
        u8::from(plan.include_disk),
        u8::from(plan.include_users),
    )
}

const FAST_STATS_SCRIPT: &str = r#"sh -c '
LC_ALL=C
export LC_ALL

uptime_sec=0;
if [ -r /proc/uptime ]; then
  read upraw _ </proc/uptime || upraw=0;
  uptime_sec=${upraw%.*};
fi;
[ -n "$uptime_sec" ] || uptime_sec=0;

l1=0;
l5=0;
l15=0;
if [ -r /proc/loadavg ]; then
  read l1 l5 l15 _ </proc/loadavg || {
    l1=0;
    l5=0;
    l15=0;
  };
fi;

mem_total_kb=0;
mem_avail_kb=0;
mem_buffers_kb=0;
mem_cached_kb=0;
mem_reclaimable_kb=0;
if [ -r /proc/meminfo ]; then
  while read -r mem_key mem_value mem_unit mem_rest; do
    case "$mem_key" in
      MemTotal:) mem_total_kb=${mem_value:-0} ;;
      MemAvailable:) mem_avail_kb=${mem_value:-0} ;;
      Buffers:) mem_buffers_kb=${mem_value:-0} ;;
      Cached:) mem_cached_kb=${mem_value:-0} ;;
      SReclaimable:) mem_reclaimable_kb=${mem_value:-0} ;;
    esac;
  done </proc/meminfo;
fi;
mem_used=$(((mem_total_kb - mem_avail_kb) * 1024));
mem_avail=$((mem_avail_kb * 1024));
mem_cache=$(((mem_buffers_kb + mem_cached_kb + mem_reclaimable_kb) * 1024));

printf "UPTIME\t%s\n" "$uptime_sec";
printf "LOAD\t%s\t%s\t%s\n" "$l1" "$l5" "$l15";

if [ -r /proc/stat ]; then
  while read -r name user nice system idle iowait irq softirq steal guest guest_nice rest; do
    case "$name" in
      cpu|cpu[0-9]*)
        printf "CPUTICKS\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
          "$name" \
          "${user:-0}" \
          "${nice:-0}" \
          "${system:-0}" \
          "${idle:-0}" \
          "${iowait:-0}" \
          "${irq:-0}" \
          "${softirq:-0}" \
          "${steal:-0}" \
          "${guest:-0}" \
          "${guest_nice:-0}";
        ;;
      *)
        break;
        ;;
    esac;
  done </proc/stat;
fi;

printf "MEMORY\t%s\t%s\t%s\n" "$mem_used" "$mem_avail" "$mem_cache";

if [ -r /proc/net/dev ]; then
  while IFS=: read -r nic_fields counter_fields; do
    set -- $nic_fields;
    nic=${1:-};
    [ -n "$nic" ] || continue;
    [ "$nic" != "lo" ] || continue;
    case "$nic" in
      docker*|veth*|br-*|virbr*|flannel*|cali*|tun*|tap*|vnet*|kube-ipvs0|cni*|zt*|tailscale*|wg*|dummy*|ifb*|sit*|gre*|gretap*|ip6tnl*|vxlan*|geneve*|erspan*)
        continue;
        ;;
    esac;
    if [ ! -e "/sys/class/net/$nic/device" ]; then
      derived=false;
      [ -d "/sys/class/net/$nic/bridge" ] && derived=true;
      [ -d "/sys/class/net/$nic/bonding" ] && derived=true;
      [ -d "/sys/class/net/$nic/team" ] && derived=true;
      if [ "$derived" = false ]; then
        for lower in "/sys/class/net/$nic"/lower_*; do
          if [ -e "$lower" ]; then
            derived=true;
            break;
          fi;
        done;
      fi;
      [ "$derived" = false ] || continue;
    fi;

    set -- $counter_fields;
    rx=${1:-0};
    tx=${9:-0};

    state=unknown;
    if [ -r "/sys/class/net/$nic/operstate" ]; then
      IFS= read -r state <"/sys/class/net/$nic/operstate" || state=unknown;
    fi;
    [ -n "$state" ] || state=unknown;
    carrier=0;
    if [ -r "/sys/class/net/$nic/carrier" ]; then
      IFS= read -r carrier <"/sys/class/net/$nic/carrier" || carrier=0;
    fi;
    if [ "$state" != "up" ] && [ "$carrier" != "1" ]; then
      continue;
    fi;

    printf "NETDEV\t%s\t%s\t%s\t%s\n" "$nic" "$state" "${rx:-0}" "${tx:-0}";
  done </proc/net/dev;
fi
'"#;

const SYSINFO_SCRIPT: &str = r#"sh -c '
LC_ALL=C
export LC_ALL

if [ "$NYATERM_STATIC" = 1 ] || [ "$NYATERM_DISK" = 1 ] || [ "$NYATERM_USERS" = 1 ]; then
  base=${TMPDIR:-/tmp}/sysinfo.$$;
  hostf=$base.host;
  archf=$base.arch;
  cpucoref=$base.cpucores;
  diskf=$base.disk;
  diskraw=$base.diskraw;
  dfraw=$base.dfraw;
  whof=$base.who;
  trap "rm -f \"$base\".*" 0 HUP INT TERM;
fi;

run_limited() {
  run_out=$1;
  run_seconds=$2;
  shift 2;
  run_tmp=$run_out.tmp;

  rm -f "$run_out" "$run_tmp";

  (
    "$@" >"$run_tmp" 2>/dev/null
  ) &
  run_pid=$!;

  (
    sleep "$run_seconds" 2>/dev/null || sleep 1;
    kill "$run_pid" 2>/dev/null;
    sleep 1;
    kill -9 "$run_pid" 2>/dev/null;
  ) &
  run_watch=$!;

  wait "$run_pid" 2>/dev/null;
  run_status=$?;

  kill "$run_watch" 2>/dev/null;
  wait "$run_watch" 2>/dev/null;

  if [ "$run_status" -eq 0 ]; then
    mv "$run_tmp" "$run_out" 2>/dev/null || return 1;
    return 0;
  fi;

  rm -f "$run_tmp";
  : >"$run_out";
  return 1;
}

if [ "$NYATERM_STATIC" = 1 ]; then
  host=unknown;
  if [ -r /proc/sys/kernel/hostname ]; then
    IFS= read -r host </proc/sys/kernel/hostname || host=unknown;
  fi;

  if [ -z "$host" ] || [ "$host" = "unknown" ]; then
    if run_limited "$hostf" 1 uname -n && [ -s "$hostf" ]; then
      IFS= read -r host <"$hostf" || host=unknown;
    fi;
  fi;

  [ -n "$host" ] || host=unknown;
  host=$(printf "%s" "$host" | tr "\t\r\n" "   ");

  os=unknown;
  if [ -r /etc/os-release ]; then
    . /etc/os-release;
    os=${PRETTY_NAME:-unknown};
  else
    if run_limited "$hostf" 1 uname -s && [ -s "$hostf" ]; then
      IFS= read -r os <"$hostf" || os=unknown;
    fi;
  fi;
  [ -n "$os" ] || os=unknown;
  os=$(printf "%s" "$os" | tr "\t\r\n" "   ");

  arch=unknown;
  if run_limited "$archf" 1 uname -m && [ -s "$archf" ]; then
    IFS= read -r arch <"$archf" || arch=unknown;
  fi;
  [ -n "$arch" ] || arch=unknown;
fi;

if [ "$NYATERM_STATIC" = 1 ]; then
  cpu_model=$(awk -F: '"'"'
/^(model name|Hardware|Processor|cpu model)[[:space:]]*:/ && !m {
  gsub(/^[ \t]+/, "", $2);
  m=$2;
}
END {
  if (!m) m="unknown";
  print m;
}
'"'"' /proc/cpuinfo 2>/dev/null);

  cpu_model=$(printf "%s" "$cpu_model" | tr "\t\r\n" "   ");
  [ -n "$cpu_model" ] || cpu_model=unknown;

  cpu_cores=$(awk '"'"'
/^processor[[:space:]]*:/ { c++ }
END { print c+0 }
'"'"' /proc/cpuinfo 2>/dev/null);

  case $cpu_cores in
    ""|0)
      if run_limited "$cpucoref" 1 getconf _NPROCESSORS_ONLN && [ -s "$cpucoref" ]; then
        IFS= read -r cpu_cores <"$cpucoref" || cpu_cores=0;
      fi;
      ;;
  esac;
  [ -n "$cpu_cores" ] || cpu_cores=0;
fi;

if [ "$NYATERM_DISK" = 1 ]; then
  : >"$diskf";
  disk_ok=0;

if command -v findmnt >/dev/null 2>&1; then
  if run_limited "$diskraw" 2 findmnt -b -rn -o SOURCE,TARGET,FSTYPE,SIZE,AVAIL,USE%; then
    disk_ok=1;
    awk '"'"'
  BEGIN {
    OFS="\t";
  }
  {
    src=$1;
    mp=$2;
    fstype=$3;
    total=$4;
    avail=$5;
    usep=$6;

    if (src !~ "^/dev/") next;
    if (mp=="" || mp=="-") next;
    if (seen[mp]++) next;

    if (fstype ~ /^(tmpfs|devtmpfs|squashfs|overlay|proc|sysfs|cgroup|cgroup2|devpts|securityfs|pstore|bpf|tracefs|debugfs|mqueue|hugetlbfs|fusectl|configfs|autofs|ramfs|binfmt_misc)$/) next;

    gsub(/%/, "", usep);

    printf "%s\t%s\t%s\t%s\t%s\n", src, mp, total, avail, usep;
  }
  '"'"' "$diskraw" >"$diskf" 2>/dev/null || : >"$diskf";
  fi;
fi;

if [ ! -s "$diskf" ] && command -v df >/dev/null 2>&1; then
  if run_limited "$dfraw" 2 df -B1 -P; then
    disk_ok=1;
    awk '"'"'
  BEGIN {
    OFS="\t";
  }
  NR>1 {
    src=$1;
    total=$2;
    avail=$4;
    usep=$5;
    mp=$6;

    if (src !~ "^/dev/") next;
    if (mp=="" || mp=="-") next;
    if (seen[mp]++) next;

    gsub(/%/, "", usep);

    printf "%s\t%s\t%s\t%s\t%s\n", src, mp, total, avail, usep;
  }
  '"'"' "$dfraw" >"$diskf" 2>/dev/null || : >"$diskf";
  fi;
fi;

  if [ -s "$diskf" ]; then
    while IFS="$(printf "\t")" read -r disk mp total avail usep; do
      [ -n "$disk" ] || continue;
      printf "DISK\t%s\t%s\t%s\t%s\t%s\n" "$disk" "$mp" "$total" "$avail" "$usep";
    done <"$diskf";
  fi;

  if [ "$disk_ok" = 1 ]; then
    printf "DISKSTATUS\tok\n";
  else
    printf "DISKSTATUS\terror\n";
  fi;
fi;

# Keep the fast snapshot last so Rust timestamps it immediately after collection,
# even when a static or disk probe took several seconds.
uptime_sec=0;
if [ -r /proc/uptime ]; then
  read upraw _ </proc/uptime || upraw=0;
  uptime_sec=${upraw%.*};
fi;
[ -n "$uptime_sec" ] || uptime_sec=0;

l1=0;
l5=0;
l15=0;
if [ -r /proc/loadavg ]; then
  read l1 l5 l15 _ </proc/loadavg || {
    l1=0;
    l5=0;
    l15=0;
  };
fi;

mem_total_kb=0;
mem_avail_kb=0;
mem_buffers_kb=0;
mem_cached_kb=0;
mem_reclaimable_kb=0;
if [ -r /proc/meminfo ]; then
  while read -r mem_key mem_value mem_unit mem_rest; do
    case "$mem_key" in
      MemTotal:) mem_total_kb=${mem_value:-0} ;;
      MemAvailable:) mem_avail_kb=${mem_value:-0} ;;
      Buffers:) mem_buffers_kb=${mem_value:-0} ;;
      Cached:) mem_cached_kb=${mem_value:-0} ;;
      SReclaimable:) mem_reclaimable_kb=${mem_value:-0} ;;
    esac;
  done </proc/meminfo;
fi;
mem_used=$(((mem_total_kb - mem_avail_kb) * 1024));
mem_avail=$((mem_avail_kb * 1024));
mem_cache=$(((mem_buffers_kb + mem_cached_kb + mem_reclaimable_kb) * 1024));

if [ "$NYATERM_STATIC" = 1 ]; then
  printf "SYSTEM\t%s\t%s\t%s\t%s\n" "$host" "$uptime_sec" "$os" "$arch";
  printf "CPU\t%s\t%s\n" "$cpu_model" "$cpu_cores";
else
  printf "UPTIME\t%s\n" "$uptime_sec";
fi;
printf "LOAD\t%s\t%s\t%s\n" "$l1" "$l5" "$l15";

if [ -r /proc/stat ]; then
  while read -r name user nice system idle iowait irq softirq steal guest guest_nice rest; do
    case "$name" in
      cpu|cpu[0-9]*)
        printf "CPUTICKS\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
          "$name" \
          "${user:-0}" \
          "${nice:-0}" \
          "${system:-0}" \
          "${idle:-0}" \
          "${iowait:-0}" \
          "${irq:-0}" \
          "${softirq:-0}" \
          "${steal:-0}" \
          "${guest:-0}" \
          "${guest_nice:-0}";
        ;;
      *)
        break;
        ;;
    esac;
  done </proc/stat;
fi;

printf "MEMORY\t%s\t%s\t%s\n" "$mem_used" "$mem_avail" "$mem_cache";

if [ "$NYATERM_USERS" = 1 ]; then
  if ! command -v who >/dev/null 2>&1; then
    printf "USERS_STATUS\tunavailable\n";
  elif run_limited "$whof" 1 who; then
    if awk '"'"'
NF { printf "LOGIN_SESSION\t%s\n", $0 }
END { print "USERS_STATUS\tavailable" }
'"'"' "$whof" 2>/dev/null; then :; else
      printf "USERS_STATUS\tfailed\n";
    fi;
  else
    printf "USERS_STATUS\tfailed\n";
  fi;
fi;

if [ -r /proc/net/dev ]; then
  while IFS=: read -r nic_fields counter_fields; do
    set -- $nic_fields;
    nic=${1:-};
    [ -n "$nic" ] || continue;
    [ "$nic" != "lo" ] || continue;
    case "$nic" in
      docker*|veth*|br-*|virbr*|flannel*|cali*|tun*|tap*|vnet*|kube-ipvs0|cni*|zt*|tailscale*|wg*|dummy*|ifb*|sit*|gre*|gretap*|ip6tnl*|vxlan*|geneve*|erspan*)
        continue;
        ;;
    esac;
    if [ ! -e "/sys/class/net/$nic/device" ]; then
      derived=false;
      [ -d "/sys/class/net/$nic/bridge" ] && derived=true;
      [ -d "/sys/class/net/$nic/bonding" ] && derived=true;
      [ -d "/sys/class/net/$nic/team" ] && derived=true;
      if [ "$derived" = false ]; then
        for lower in "/sys/class/net/$nic"/lower_*; do
          if [ -e "$lower" ]; then
            derived=true;
            break;
          fi;
        done;
      fi;
      [ "$derived" = false ] || continue;
    fi;

    set -- $counter_fields;
    rx=${1:-0};
    tx=${9:-0};

    state=unknown;
    if [ -r "/sys/class/net/$nic/operstate" ]; then
      IFS= read -r state <"/sys/class/net/$nic/operstate" || state=unknown;
    fi;
    [ -n "$state" ] || state=unknown;
    carrier=0;
    if [ -r "/sys/class/net/$nic/carrier" ]; then
      IFS= read -r carrier <"/sys/class/net/$nic/carrier" || carrier=0;
    fi;
    if [ "$state" != "up" ] && [ "$carrier" != "1" ]; then
      continue;
    fi;

    printf "NETDEV\t%s\t%s\t%s\t%s\n" "$nic" "$state" "${rx:-0}" "${tx:-0}";
  done </proc/net/dev;
fi
'"#;

pub fn parse_stats_output(output: &str) -> AppResult<ParsedRemoteStats> {
    let mut stats = RemoteStats::default();
    let mut cpu_snapshot = CpuSnapshot::default();
    let mut has_cpu_snapshot = false;
    let mut networks = BTreeMap::new();
    let mut seen_disk_mounts = HashSet::new();
    let mut static_system = None;
    let mut static_cpu = None;
    let mut saw_disk_line = false;
    let mut disk_probe_succeeded = None;
    let mut users = BTreeMap::<String, u32>::new();
    let mut login_sessions = BTreeMap::<String, u32>::new();
    let mut invalid_users = false;
    let mut saw_users_status = false;

    for line in output.lines() {
        let cols: Vec<&str> = line.split('\t').collect();

        if cols.is_empty() {
            continue;
        }

        match cols[0] {
            "SYSTEM" if cols.len() >= 5 => {
                let uptime_sec = parse_u64_field(cols[2], "SYSTEM uptime")?;
                cpu_snapshot.uptime_sec = uptime_sec;
                stats.system = SystemInfo {
                    hostname: cols[1].to_string(),
                    uptime_sec,
                    os: cols[3].to_string(),
                    arch: cols[4].to_string(),
                };
                static_system = Some(stats.system.clone());
            }

            "UPTIME" if cols.len() >= 2 => {
                let uptime_sec = parse_u64_field(cols[1], "UPTIME")?;
                cpu_snapshot.uptime_sec = uptime_sec;
                stats.system.uptime_sec = uptime_sec;
            }

            "LOAD" if cols.len() >= 4 => {
                stats.load = LoadInfo {
                    load1: cols[1].parse().unwrap_or(0.0),
                    load5: cols[2].parse().unwrap_or(0.0),
                    load15: cols[3].parse().unwrap_or(0.0),
                };
            }

            "CPU" if cols.len() >= 3 => {
                let model = cols[1].to_string();
                let cores = cols[2].parse().unwrap_or(0);
                stats.cpu = CpuInfo {
                    model: model.clone(),
                    cores,
                    usage: None,
                    per_core: Vec::new(),
                    sample_window_ms: None,
                    usage_source: CpuUsageSource::WarmingUp,
                };
                static_cpu = Some((model, cores));
            }

            "CPUTICKS" if cols.len() >= 12 => {
                let ticks = parse_cpu_ticks(&cols)?;
                match cols[1] {
                    "cpu" => {
                        cpu_snapshot.aggregate = ticks;
                        has_cpu_snapshot = true;
                    }
                    cpu_name if cpu_name.starts_with("cpu") => {
                        let id = cpu_name[3..].parse::<u32>().map_err(|error| {
                            AppError::Config(format!("Invalid CPU core id '{cpu_name}': {error}"))
                        })?;
                        cpu_snapshot.cores.insert(id, ticks);
                        has_cpu_snapshot = true;
                    }
                    _ => {}
                }
            }

            "MEMORY" if cols.len() >= 4 => {
                stats.memory = MemoryInfo {
                    used: cols[1].parse().unwrap_or(0),
                    available: cols[2].parse().unwrap_or(0),
                    cached: cols[3].parse().unwrap_or(0),
                };
            }

            "USERS_STATUS" => {
                saw_users_status = true;
                if stats.users_status != LoggedInUsersStatus::NotCollected {
                    invalid_users = true;
                }
                stats.users_status = match cols.as_slice() {
                    [_, "available"] => LoggedInUsersStatus::Available,
                    [_, "unavailable"] => LoggedInUsersStatus::Unavailable,
                    _ => LoggedInUsersStatus::Failed,
                };
            }

            "USER" => {
                // Legacy name+session-count records. Detailed LOGIN_SESSION rows
                // take precedence when both are present, so these are only a
                // fallback for older probes.
                let valid = (|| {
                    if cols.len() != 3
                        || cols[1].is_empty()
                        || cols[1].chars().any(char::is_control)
                        || !cols[2].bytes().all(|byte| byte.is_ascii_digit())
                    {
                        return None;
                    }
                    let count = cols[2].parse::<u32>().ok().filter(|count| *count > 0)?;
                    let total = users.entry(cols[1].to_string()).or_default();
                    *total = total.checked_add(count)?;
                    Some(())
                })();
                invalid_users |= valid.is_none();
            }

            "LOGIN_SESSION" => {
                // `who` output: "<name> <terminal> <date> <time> [(<source>)]".
                let record = line.split_once('\t').map(|(_, rest)| rest).unwrap_or("");
                let mut parts = record.split_whitespace();
                match parts.next() {
                    Some(name) if !name.is_empty() && !name.chars().any(char::is_control) => {
                        let total = login_sessions.entry(name.to_string()).or_default();
                        *total = match total.checked_add(1) {
                            Some(total) => total,
                            None => {
                                invalid_users = true;
                                *total
                            }
                        };
                    }
                    _ => invalid_users = true,
                }
            }

            "NETDEV" if cols.len() >= 5 => {
                if cols[1] != "-" {
                    let rx_bytes = parse_u64_field(cols[3], "NETDEV rx bytes")?;
                    let tx_bytes = parse_u64_field(cols[4], "NETDEV tx bytes")?;
                    networks.insert(cols[1].to_string(), NetworkCounters { rx_bytes, tx_bytes });
                    stats.networks.push(NetworkInfo {
                        nic: cols[1].to_string(),
                        state: cols[2].to_string(),
                        rx_bytes_per_sec: 0.0,
                        tx_bytes_per_sec: 0.0,
                        rate_status: NetworkRateStatus::WarmingUp,
                    });
                }
            }

            "NETWORK" if cols.len() >= 5 => {
                if cols[1] != "-" {
                    stats.networks.push(NetworkInfo {
                        nic: cols[1].to_string(),
                        state: cols[2].to_string(),
                        rx_bytes_per_sec: cols[3].parse().unwrap_or(0.0),
                        tx_bytes_per_sec: cols[4].parse().unwrap_or(0.0),
                        // Legacy NETWORK rows already carry a rate, so it is
                        // the best available value even without counters.
                        rate_status: NetworkRateStatus::Available,
                    });
                }
            }

            "DISK" if cols.len() >= 6 => {
                saw_disk_line = true;
                if cols[1] != "-" {
                    let mount = cols[2].trim();

                    if mount.is_empty() || mount == "-" {
                        continue;
                    }

                    if seen_disk_mounts.insert(mount.to_string()) {
                        stats.disks.push(DiskInfo {
                            device: cols[1].to_string(),
                            mount: mount.to_string(),
                            total: cols[3].parse().unwrap_or(0),
                            available: cols[4].parse().unwrap_or(0),
                            use_percent: cols[5].parse().unwrap_or(0),
                        });
                    }
                }
            }

            "DISKSTATUS" if cols.len() >= 2 => {
                disk_probe_succeeded = Some(cols[1] == "ok");
            }

            _ => {}
        }
    }

    update_network_summary(&mut stats);

    let static_info = static_system
        .zip(static_cpu)
        .map(|(system, (cpu_model, cpu_cores))| StaticRemoteStats {
            system,
            cpu_model,
            cpu_cores,
        });
    let disks = match disk_probe_succeeded {
        Some(true) => Some(stats.disks.clone()),
        Some(false) => {
            stats.disks.clear();
            None
        }
        None if saw_disk_line => Some(stats.disks.clone()),
        None => None,
    };

    if !login_sessions.is_empty() {
        // Detailed records are authoritative; legacy USER summaries must not
        // double-count the same sessions when both record types are present.
        users.clear();
        users.extend(login_sessions.iter().map(|(name, n)| (name.clone(), *n)));
    }
    if invalid_users || (!users.is_empty() && stats.users_status != LoggedInUsersStatus::Available)
    {
        stats.users_status = LoggedInUsersStatus::Failed;
    }
    if stats.users_status == LoggedInUsersStatus::Available {
        stats.users = users
            .into_iter()
            .map(|(name, sessions)| LoggedInUser { name, sessions })
            .collect();
    }

    Ok(ParsedRemoteStats {
        stats,
        cpu_snapshot: has_cpu_snapshot.then_some(cpu_snapshot),
        networks,
        static_info,
        disks,
        disk_probe_attempted: disk_probe_succeeded.is_some() || saw_disk_line,
        users_probe_attempted: saw_users_status,
    })
}

fn parse_cpu_ticks(cols: &[&str]) -> AppResult<CpuTicks> {
    Ok(CpuTicks {
        user: parse_u64_field(cols[2], "CPUTICKS user")?,
        nice: parse_u64_field(cols[3], "CPUTICKS nice")?,
        system: parse_u64_field(cols[4], "CPUTICKS system")?,
        idle: parse_u64_field(cols[5], "CPUTICKS idle")?,
        iowait: parse_u64_field(cols[6], "CPUTICKS iowait")?,
        irq: parse_u64_field(cols[7], "CPUTICKS irq")?,
        softirq: parse_u64_field(cols[8], "CPUTICKS softirq")?,
        steal: parse_u64_field(cols[9], "CPUTICKS steal")?,
        guest: parse_u64_field(cols[10], "CPUTICKS guest")?,
        guest_nice: parse_u64_field(cols[11], "CPUTICKS guest_nice")?,
    })
}

fn parse_u64_field(value: &str, field: &str) -> AppResult<u64> {
    value
        .parse::<u64>()
        .map_err(|error| AppError::Config(format!("Invalid {field} value '{value}': {error}")))
}

#[cfg(test)]
mod tests {
    use super::{
        CpuTicks, CpuUsageSource, DISK_REFRESH_INTERVAL, LoggedInUsersStatus, RemoteStatsSampler,
        StatsProbePlan, build_stats_script, calculate_delta, parse_stats_output, usage_percent,
    };
    use std::time::{Duration, Instant};

    fn cpu_line(model: &str, cores: u32) -> String {
        format!("CPU\t{model}\t{cores}\n")
    }

    fn ticks_line(name: &str, user: u64, nice: u64, system: u64, idle: u64) -> String {
        format!("CPUTICKS\t{name}\t{user}\t{nice}\t{system}\t{idle}\t0\t0\t0\t0\t0\t0\n")
    }

    fn snapshot_output(
        uptime: u64,
        aggregate: (u64, u64, u64, u64),
        cores: &[(u32, u64, u64)],
    ) -> String {
        let mut output = format!(
            "SYSTEM\tnode-1\t{uptime}\tUbuntu 24.04\tx86_64\nLOAD\t0.10\t0.20\t0.30\n{}",
            cpu_line("AMD Ryzen", cores.len() as u32)
        );
        output.push_str(&ticks_line(
            "cpu",
            aggregate.0,
            aggregate.1,
            aggregate.2,
            aggregate.3,
        ));
        for (id, busy, idle) in cores {
            output.push_str(&ticks_line(&format!("cpu{id}"), *busy, 0, 0, *idle));
        }
        output.push_str(
            "MEMORY\t1000\t3000\t500\nNETDEV\teth0\tup\t1000\t2000\nDISK\t/dev/sda1\t/\t10000\t4000\t60\n",
        );
        output
    }

    #[test]
    fn parse_stats_output_collects_logged_in_users_sorted_by_name() {
        let stats = parse_stats_output(
            "USERS_STATUS\tavailable\n\
             LOGIN_SESSION\troot     pts/0        2026-11-17 09:12 (10.0.0.5)\n\
             LOGIN_SESSION\talice    pts/1        2026-11-17 09:30 (10.0.0.6)\n\
             LOGIN_SESSION\talice    tty1         2026-11-17 08:00\n\
             MEMORY\t1\t2\t3\n",
        )
        .unwrap()
        .stats;

        assert_eq!(stats.users_status, LoggedInUsersStatus::Available);
        assert_eq!(
            stats
                .users
                .iter()
                .map(|user| (user.name.as_str(), user.sessions))
                .collect::<Vec<_>>(),
            vec![("alice", 2), ("root", 1)]
        );
    }

    #[test]
    fn user_probe_failure_modes_never_expose_partial_lists() {
        let outside_probe = parse_stats_output("MEMORY\t1\t2\t3\n").unwrap().stats;
        assert_eq!(
            outside_probe.users_status,
            LoggedInUsersStatus::NotCollected
        );
        assert!(outside_probe.users.is_empty());

        let unavailable = parse_stats_output(
            "USERS_STATUS\tunavailable\nLOGIN_SESSION\troot     pts/0  2026-11-17 09:12\n",
        )
        .unwrap()
        .stats;
        assert_eq!(unavailable.users_status, LoggedInUsersStatus::Failed);
        assert!(unavailable.users.is_empty());

        let unparsable = parse_stats_output("USERS_STATUS\tavailable\nLOGIN_SESSION\t\n")
            .unwrap()
            .stats;
        assert_eq!(unparsable.users_status, LoggedInUsersStatus::Failed);
        assert!(unparsable.users.is_empty());

        let empty = parse_stats_output("USERS_STATUS\tavailable\n")
            .unwrap()
            .stats;
        assert_eq!(empty.users_status, LoggedInUsersStatus::Available);
        assert!(empty.users.is_empty());
    }

    #[test]
    fn user_probe_is_opt_in_and_uses_bounded_who() {
        let without = build_stats_script(StatsProbePlan {
            include_static: false,
            include_disk: false,
            include_users: false,
        });
        assert!(!without.contains("who"));
        assert!(!without.contains("NYATERM_USERS"));

        let with = build_stats_script(StatsProbePlan {
            include_static: false,
            include_disk: false,
            include_users: true,
        });
        assert!(with.contains("NYATERM_USERS=1"));
        assert!(with.contains("run_limited \"$whof\" 1 who"));
    }

    #[test]
    fn parse_stats_output_parses_complete_snapshot() {
        let parsed = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             LOAD\t0.10\t0.20\t0.30\n\
             CPU\tAMD Ryzen\t8\n\
             CPUTICKS\tcpu\t100\t0\t50\t850\t0\t0\t0\t0\t0\t0\n\
             CPUTICKS\tcpu0\t10\t0\t5\t85\t0\t0\t0\t0\t0\t0\n\
             CPUTICKS\tcpu1\t15\t0\t5\t80\t0\t0\t0\t0\t0\t0\n\
             MEMORY\t1000\t3000\t500\n\
             NETDEV\teth0\tup\t100\t200\n\
             NETDEV\twlan0\tup\t50\t25\n\
             DISK\t/dev/sda1\t/\t10000\t4000\t60\n",
        )
        .unwrap();
        let stats = parsed.stats;

        assert_eq!(stats.system.hostname, "node-1");
        assert_eq!(stats.system.uptime_sec, 12345);
        assert_eq!(stats.system.os, "Ubuntu 24.04");
        assert_eq!(stats.system.arch, "x86_64");
        assert_eq!(stats.load.load1, 0.10);
        assert_eq!(stats.cpu.model, "AMD Ryzen");
        assert_eq!(stats.cpu.cores, 8);
        assert_eq!(stats.cpu.usage, None);
        assert!(stats.cpu.per_core.is_empty());
        assert_eq!(stats.cpu.usage_source, CpuUsageSource::WarmingUp);
        assert_eq!(stats.memory.used, 1000);
        assert_eq!(stats.memory.available, 3000);
        assert_eq!(stats.memory.cached, 500);
        assert_eq!(stats.networks.len(), 2);
        assert_eq!(stats.network_summary.rx_bytes_per_sec, 0.0);
        assert_eq!(stats.network_summary.tx_bytes_per_sec, 0.0);
        assert_eq!(stats.disks.len(), 1);
        assert_eq!(stats.disks[0].mount, "/");
        assert_eq!(stats.disks[0].available, 4000);
        assert!(parsed.cpu_snapshot.is_some());
        assert_eq!(parsed.networks.len(), 2);
    }

    #[test]
    fn parse_stats_output_keeps_partial_snapshot_without_disks() {
        let without_disk = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             LOAD\t0.10\t0.20\t0.30\n\
             CPU\tAMD Ryzen\t8\n\
             CPUTICKS\tcpu\t100\t0\t50\t850\t0\t0\t0\t0\t0\t0\n\
             MEMORY\t1000\t3000\t500\n\
             NETDEV\teth0\tup\t100\t200\n",
        )
        .unwrap()
        .stats;

        assert_eq!(without_disk.cpu.usage, None);
        assert_eq!(without_disk.memory.available, 3000);
        assert_eq!(without_disk.network_summary.rx_bytes_per_sec, 0.0);
        assert!(without_disk.disks.is_empty());

        let placeholder_disk = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             LOAD\t0.10\t0.20\t0.30\n\
             CPU\tAMD Ryzen\t8\n\
             CPUTICKS\tcpu\t100\t0\t50\t850\t0\t0\t0\t0\t0\t0\n\
             MEMORY\t1000\t3000\t500\n\
             NETDEV\teth0\tup\t100\t200\n\
             DISK\t-\t-\t0\t0\t0\n",
        )
        .unwrap()
        .stats;

        assert_eq!(placeholder_disk.cpu.usage, None);
        assert_eq!(placeholder_disk.network_summary.tx_bytes_per_sec, 0.0);
        assert!(placeholder_disk.disks.is_empty());
    }

    #[test]
    fn parse_stats_output_deduplicates_disk_mounts() {
        let stats = parse_stats_output(
            "DISK\t/dev/sda1\t/\t10000\t4000\t60\n\
             DISK\t/dev/disk/by-uuid/root\t/\t10000\t3000\t70\n\
             DISK\t/dev/sdb1\t/data\t20000\t15000\t25\n",
        )
        .unwrap()
        .stats;

        assert_eq!(stats.disks.len(), 2);
        assert_eq!(stats.disks[0].device, "/dev/sda1");
        assert_eq!(stats.disks[0].mount, "/");
        assert_eq!(stats.disks[1].mount, "/data");
    }

    #[test]
    fn fast_script_contains_only_proc_and_sys_probes() {
        let script = build_stats_script(StatsProbePlan {
            include_static: false,
            include_disk: false,
            include_users: false,
        });

        for forbidden in [
            "findmnt",
            "df -B1",
            "uname",
            "getconf",
            "/proc/cpuinfo",
            "run_limited",
        ] {
            assert!(
                !script.contains(forbidden),
                "fast script contains {forbidden}"
            );
        }
        assert!(script.contains("/proc/stat"));
        assert!(script.contains("/proc/meminfo"));
        assert!(script.contains("/proc/net/dev"));
        assert!(script.contains("/sys/class/net"));
    }

    #[test]
    fn network_probe_keeps_main_virtual_nics_and_filters_derived_interfaces() {
        for plan in [
            StatsProbePlan {
                include_static: false,
                include_disk: false,
                include_users: false,
            },
            StatsProbePlan {
                include_static: true,
                include_disk: true,
                include_users: false,
            },
        ] {
            let script = build_stats_script(plan);

            assert!(!script.contains("[ -e \"/sys/class/net/$nic/device\" ] || continue"));
            assert!(script.contains("if [ ! -e \"/sys/class/net/$nic/device\" ]; then"));
            assert!(script.contains("/sys/class/net/$nic/bridge"));
            assert!(script.contains("/sys/class/net/$nic/bonding"));
            assert!(script.contains("/sys/class/net/$nic/team"));
            assert!(script.contains("\"/sys/class/net/$nic\"/lower_*"));
            assert!(script.contains("/sys/class/net/$nic/carrier"));
            assert!(
                script.contains("if [ \"$state\" != \"up\" ] && [ \"$carrier\" != \"1\" ]; then")
            );
        }
    }

    #[test]
    fn combined_script_collects_slow_data_before_fast_counters() {
        let script = build_stats_script(StatsProbePlan {
            include_static: true,
            include_disk: true,
            include_users: false,
        });
        let static_probe = script.find("/proc/cpuinfo").unwrap();
        let disk_probe = script.find("findmnt -b").unwrap();
        let fast_probe = script.rfind("/proc/uptime").unwrap();
        let network_probe = script.rfind("/proc/net/dev").unwrap();

        assert!(static_probe < disk_probe);
        assert!(disk_probe < fast_probe);
        assert!(fast_probe < network_probe);
    }

    #[tokio::test]
    async fn injected_sample_times_drive_network_rate_and_sample_window() {
        let sampler = RemoteStatsSampler::default();
        let lease = sampler.lock_session("s1").await;
        let started_at = Instant::now();
        let first =
            parse_stats_output(&snapshot_output(10, (100, 0, 0, 900), &[(0, 100, 900)])).unwrap();
        sampler
            .complete_snapshot_at("s1", &lease, first, started_at)
            .await;

        let second_output = snapshot_output(12, (120, 0, 0, 1080), &[(0, 120, 1080)]).replace(
            "NETDEV\teth0\tup\t1000\t2000",
            "NETDEV\teth0\tup\t1600\t3000",
        );
        let second = parse_stats_output(&second_output).unwrap();
        let stats = sampler
            .complete_snapshot_at("s1", &lease, second, started_at + Duration::from_secs(2))
            .await;

        assert_eq!(stats.cpu.sample_window_ms, Some(2_000));
        assert!((stats.networks[0].rx_bytes_per_sec - 300.0).abs() < f64::EPSILON);
        assert!((stats.networks[0].tx_bytes_per_sec - 500.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn static_and_disk_cache_are_isolated_and_cleared_per_session() {
        let sampler = RemoteStatsSampler::default();
        assert_eq!(
            sampler.probe_plan("s1").await,
            StatsProbePlan {
                include_static: true,
                include_disk: true,
                include_users: true,
            }
        );

        let initial =
            parse_stats_output(&snapshot_output(10, (100, 0, 0, 900), &[(0, 100, 900)])).unwrap();
        sampler.complete_snapshot("s1", initial).await;

        assert_eq!(
            sampler.probe_plan("s1").await,
            StatsProbePlan {
                include_static: false,
                include_disk: false,
                // `snapshot_output` carries no USERS_STATUS line, so the user
                // probe has not yet been attempted and stays scheduled.
                include_users: true,
            }
        );
        assert_eq!(
            sampler.probe_plan("s2").await,
            StatsProbePlan {
                include_static: true,
                include_disk: true,
                include_users: true,
            }
        );

        let fast = parse_stats_output(
            "UPTIME\t11\nLOAD\t0.10\t0.20\t0.30\n\
             CPUTICKS\tcpu\t110\t0\t0\t990\t0\t0\t0\t0\t0\t0\n\
             CPUTICKS\tcpu0\t110\t0\t0\t990\t0\t0\t0\t0\t0\t0\n\
             MEMORY\t1000\t3000\t500\nNETDEV\teth0\tup\t1100\t2200\n",
        )
        .unwrap();
        let stats = sampler.complete_snapshot("s1", fast).await;
        assert_eq!(stats.system.hostname, "node-1");
        assert_eq!(stats.system.uptime_sec, 11);
        assert_eq!(stats.cpu.model, "AMD Ryzen");
        assert_eq!(stats.disks[0].mount, "/");

        sampler.clear_session("s1").await;
        assert_eq!(
            sampler.probe_plan("s1").await,
            StatsProbePlan {
                include_static: true,
                include_disk: true,
                include_users: true,
            }
        );
    }

    #[tokio::test]
    async fn clear_invalidates_in_flight_work_and_allows_same_id_reuse() {
        let sampler = RemoteStatsSampler::default();
        let stale_lease = sampler.lock_session("s1").await;
        assert!(stale_lease.is_current());

        sampler.clear_session("s1").await;
        assert!(!stale_lease.is_current());
        assert!(sampler.session_states.lock().await.is_empty());

        let stale =
            parse_stats_output(&snapshot_output(10, (100, 0, 0, 900), &[(0, 100, 900)])).unwrap();
        sampler
            .complete_snapshot_at("s1", &stale_lease, stale, Instant::now())
            .await;

        assert_eq!(
            sampler.probe_plan("s1").await,
            StatsProbePlan {
                include_static: true,
                include_disk: true,
                include_users: true,
            }
        );

        let replacement_lease = sampler.lock_session("s1").await;
        assert!(replacement_lease.is_current());
        let replacement =
            parse_stats_output(&snapshot_output(11, (110, 0, 0, 990), &[(0, 110, 990)])).unwrap();
        sampler
            .complete_snapshot_at("s1", &replacement_lease, replacement, Instant::now())
            .await;
        assert_eq!(
            sampler.probe_plan("s1").await,
            StatsProbePlan {
                include_static: false,
                include_disk: false,
                include_users: true,
            }
        );
    }

    #[tokio::test]
    async fn expired_disk_refresh_failure_preserves_and_throttles_the_old_cache() {
        let sampler = RemoteStatsSampler::default();
        let initial =
            parse_stats_output(&snapshot_output(10, (100, 0, 0, 900), &[(0, 100, 900)])).unwrap();
        sampler.complete_snapshot("s1", initial).await;

        let now = Instant::now();
        let attempted_at = sampler
            .samples
            .lock()
            .await
            .get("s1")
            .unwrap()
            .disk_attempted_at
            .unwrap();
        assert!(
            !sampler
                .probe_plan_at(
                    "s1",
                    attempted_at + DISK_REFRESH_INTERVAL - Duration::from_millis(1),
                )
                .await
                .include_disk
        );
        {
            let mut cached_samples = sampler.samples.lock().await;
            cached_samples.get_mut("s1").unwrap().disk_attempted_at =
                Some(now.checked_sub(DISK_REFRESH_INTERVAL).unwrap());
        }
        assert!(sampler.probe_plan_at("s1", now).await.include_disk);

        let failed_refresh = parse_stats_output(
            "UPTIME\t11\nCPUTICKS\tcpu\t110\t0\t0\t990\t0\t0\t0\t0\t0\t0\n\
             MEMORY\t1000\t3000\t500\nDISKSTATUS\terror\n",
        )
        .unwrap();
        let stats = sampler.complete_snapshot("s1", failed_refresh).await;

        assert_eq!(stats.disks.len(), 1);
        assert_eq!(stats.disks[0].mount, "/");
        assert!(!sampler.probe_plan("s1").await.include_disk);
    }

    #[tokio::test]
    async fn successful_disk_refresh_replaces_and_reuses_the_cache() {
        let sampler = RemoteStatsSampler::default();
        let refresh = parse_stats_output(
            "SYSTEM\tnode-1\t10\tLinux\tx86_64\nCPU\tCPU\t1\n\
             CPUTICKS\tcpu\t100\t0\t0\t900\t0\t0\t0\t0\t0\t0\n\
             DISK\t/dev/sdb1\t/data\t20000\t15000\t25\nDISKSTATUS\tok\n",
        )
        .unwrap();
        let stats = sampler.complete_snapshot("s1", refresh).await;

        assert_eq!(stats.disks[0].mount, "/data");
        assert!(!sampler.probe_plan("s1").await.include_disk);
    }

    #[tokio::test]
    async fn first_sample_returns_warming_up() {
        let sampler = RemoteStatsSampler::default();
        let parsed =
            parse_stats_output(&snapshot_output(10, (100, 0, 0, 900), &[(0, 10, 90)])).unwrap();
        let stats = sampler.complete_snapshot("s1", parsed).await;

        assert_eq!(stats.cpu.usage, None);
        assert_eq!(stats.cpu.usage_source, CpuUsageSource::WarmingUp);
    }

    #[tokio::test]
    async fn one_busy_core_on_32_cpus_is_about_three_percent() {
        let sampler = RemoteStatsSampler::default();
        let cores1: Vec<_> = (0..32).map(|id| (id, 0, 100)).collect();
        let cores2: Vec<_> = (0..32)
            .map(|id| {
                if id == 0 {
                    (id, 100, 100)
                } else {
                    (id, 0, 200)
                }
            })
            .collect();

        let first = parse_stats_output(&snapshot_output(10, (0, 0, 0, 3200), &cores1)).unwrap();
        sampler.complete_snapshot("s1", first).await;
        let second = parse_stats_output(&snapshot_output(11, (100, 0, 0, 6300), &cores2)).unwrap();
        let stats = sampler.complete_snapshot("s1", second).await;

        let usage = stats.cpu.usage.unwrap();
        assert!((usage - 3.125).abs() < 0.01, "{usage}");
    }

    #[tokio::test]
    async fn aggregate_matches_weighted_core_usage() {
        let sampler = RemoteStatsSampler::default();
        let first = parse_stats_output(&snapshot_output(
            10,
            (100, 0, 0, 900),
            &[(0, 50, 450), (1, 50, 450)],
        ))
        .unwrap();
        sampler.complete_snapshot("s1", first).await;
        let second = parse_stats_output(&snapshot_output(
            11,
            (120, 0, 0, 980),
            &[(0, 60, 490), (1, 60, 490)],
        ))
        .unwrap();
        let stats = sampler.complete_snapshot("s1", second).await;

        assert_eq!(stats.cpu.usage_source, CpuUsageSource::Aggregate);
        assert!((stats.cpu.usage.unwrap() - 20.0).abs() < 0.01);
    }

    #[tokio::test]
    async fn inconsistent_aggregate_uses_core_fallback() {
        let sampler = RemoteStatsSampler::default();
        let first = parse_stats_output(&snapshot_output(
            10,
            (100, 0, 0, 900),
            &[(0, 50, 450), (1, 50, 450)],
        ))
        .unwrap();
        sampler.complete_snapshot("s1", first).await;
        let second = parse_stats_output(&snapshot_output(
            11,
            (194, 0, 0, 906),
            &[(0, 55, 495), (1, 55, 495)],
        ))
        .unwrap();
        let stats = sampler.complete_snapshot("s1", second).await;

        assert_eq!(stats.cpu.usage_source, CpuUsageSource::CoreWeightedFallback);
        assert!((stats.cpu.usage.unwrap() - 10.0).abs() < 0.01);
    }

    #[test]
    fn zero_delta_returns_none_instead_of_zero() {
        let ticks = CpuTicks {
            user: 1,
            idle: 1,
            ..CpuTicks::default()
        };

        assert_eq!(calculate_delta(&ticks, &ticks), None);
    }

    #[tokio::test]
    async fn counter_rollback_resets_baseline() {
        let sampler = RemoteStatsSampler::default();
        let first =
            parse_stats_output(&snapshot_output(10, (100, 0, 0, 900), &[(0, 100, 900)])).unwrap();
        sampler.complete_snapshot("s1", first).await;
        let second =
            parse_stats_output(&snapshot_output(11, (90, 0, 0, 950), &[(0, 90, 950)])).unwrap();
        let stats = sampler.complete_snapshot("s1", second).await;

        assert_eq!(stats.cpu.usage, None);
        assert_eq!(stats.cpu.usage_source, CpuUsageSource::WarmingUp);
    }

    #[tokio::test]
    async fn uptime_rollback_detects_remote_reboot() {
        let sampler = RemoteStatsSampler::default();
        let first =
            parse_stats_output(&snapshot_output(10, (100, 0, 0, 900), &[(0, 100, 900)])).unwrap();
        sampler.complete_snapshot("s1", first).await;
        let second =
            parse_stats_output(&snapshot_output(5, (110, 0, 0, 990), &[(0, 110, 990)])).unwrap();
        let stats = sampler.complete_snapshot("s1", second).await;

        assert_eq!(stats.cpu.usage, None);
        assert_eq!(stats.cpu.usage_source, CpuUsageSource::WarmingUp);
    }

    #[test]
    fn large_counters_above_i32_max_are_parsed_as_u64() {
        let parsed = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             CPU\tAMD Ryzen\t1\n\
             CPUTICKS\tcpu\t2147483648\t0\t0\t2147483649\t0\t0\t0\t0\t0\t0\n",
        )
        .unwrap();

        assert_eq!(parsed.cpu_snapshot.unwrap().aggregate.user, 2_147_483_648);
    }

    #[tokio::test]
    async fn sparse_cpu_ids_keep_their_original_ids() {
        let sampler = RemoteStatsSampler::default();
        let first = parse_stats_output(&snapshot_output(
            10,
            (100, 0, 0, 900),
            &[(0, 50, 450), (2, 50, 450)],
        ))
        .unwrap();
        sampler.complete_snapshot("s1", first).await;
        let second = parse_stats_output(&snapshot_output(
            11,
            (120, 0, 0, 980),
            &[(0, 60, 490), (2, 60, 490)],
        ))
        .unwrap();
        let stats = sampler.complete_snapshot("s1", second).await;

        assert_eq!(
            stats
                .cpu
                .per_core
                .iter()
                .map(|core| core.id)
                .collect::<Vec<_>>(),
            vec![0, 2]
        );
    }

    #[test]
    fn decreasing_iowait_does_not_create_cpu_spike() {
        let previous = CpuTicks {
            idle: 100,
            iowait: 100,
            ..CpuTicks::default()
        };
        let current = CpuTicks {
            idle: 200,
            iowait: 90,
            ..CpuTicks::default()
        };

        let delta = calculate_delta(&previous, &current).unwrap();
        assert_eq!(usage_percent(delta), 0.0);
    }

    #[test]
    fn invalid_cpu_counter_is_not_silently_parsed_as_zero() {
        let parsed = parse_stats_output(
            "SYSTEM\tnode-1\t12345\tUbuntu 24.04\tx86_64\n\
             CPU\tAMD Ryzen\t1\n\
             CPUTICKS\tcpu\tbad\t0\t0\t100\t0\t0\t0\t0\t0\t0\n",
        );

        assert!(parsed.is_err());
    }

    fn network_sample(
        counters: &[(&str, u64, u64)],
        updated_at: Instant,
    ) -> super::CachedRemoteSample {
        super::CachedRemoteSample {
            static_info: None,
            disks: None,
            disk_attempted_at: None,
            users: Vec::new(),
            users_status: LoggedInUsersStatus::NotCollected,
            users_attempted_at: None,
            cpu_snapshot: None,
            networks: counters
                .iter()
                .map(|(nic, rx, tx)| {
                    (
                        (*nic).to_string(),
                        super::NetworkCounters {
                            rx_bytes: *rx,
                            tx_bytes: *tx,
                        },
                    )
                })
                .collect(),
            updated_at,
        }
    }

    fn network_stats(nics: &[&str]) -> super::RemoteStats {
        let mut stats = super::RemoteStats::default();
        stats.networks = nics
            .iter()
            .map(|nic| super::NetworkInfo {
                nic: (*nic).to_string(),
                state: "up".to_string(),
                rx_bytes_per_sec: 0.0,
                tx_bytes_per_sec: 0.0,
                rate_status: super::NetworkRateStatus::WarmingUp,
            })
            .collect();
        stats
    }

    #[test]
    fn network_rate_divides_the_counter_delta_by_the_window() {
        let now = Instant::now();
        let previous = network_sample(&[("eth0", 1_000, 2_000)], now);
        let mut stats = network_stats(&["eth0"]);

        super::apply_network_rates(
            &previous,
            Duration::from_secs(2),
            &network_sample(&[("eth0", 5_000, 4_000)], now).networks,
            &mut stats,
        );

        assert_eq!(
            stats.networks[0].rate_status,
            super::NetworkRateStatus::Available
        );
        assert_eq!(stats.networks[0].rx_bytes_per_sec, 2_000.0);
        assert_eq!(stats.networks[0].tx_bytes_per_sec, 1_000.0);
    }

    #[test]
    fn network_rate_does_not_report_a_spike_when_counters_go_backwards() {
        // A NIC reset, reboot, or a sysinfo read returning zero produces a
        // smaller counter. Neither clamping nor wrapping is a real rate.
        let now = Instant::now();
        let previous = network_sample(&[("eth0", 9_000_000, 9_000_000)], now);
        let mut stats = network_stats(&["eth0"]);

        super::apply_network_rates(
            &previous,
            Duration::from_secs(3),
            &network_sample(&[("eth0", 0, 0)], now).networks,
            &mut stats,
        );

        assert_eq!(
            stats.networks[0].rate_status,
            super::NetworkRateStatus::CounterReset
        );
        assert_eq!(stats.networks[0].rx_bytes_per_sec, 0.0);
        assert_eq!(stats.networks[0].tx_bytes_per_sec, 0.0);
    }

    #[test]
    fn network_rate_marks_a_long_gap_as_interrupted() {
        let now = Instant::now();
        let previous = network_sample(&[("eth0", 1_000, 1_000)], now);
        let mut stats = network_stats(&["eth0"]);

        super::apply_network_rates(
            &previous,
            Duration::from_secs(10 * 60),
            &network_sample(&[("eth0", 9_000_000, 9_000_000)], now).networks,
            &mut stats,
        );

        assert_eq!(
            stats.networks[0].rate_status,
            super::NetworkRateStatus::Interrupted
        );
        assert_eq!(stats.networks[0].rx_bytes_per_sec, 0.0);
    }

    #[test]
    fn network_rate_ignores_a_too_short_window() {
        let now = Instant::now();
        let previous = network_sample(&[("eth0", 1_000, 1_000)], now);
        let mut stats = network_stats(&["eth0"]);

        super::apply_network_rates(
            &previous,
            Duration::from_millis(5),
            &network_sample(&[("eth0", 9_000_000, 9_000_000)], now).networks,
            &mut stats,
        );

        assert_eq!(
            stats.networks[0].rate_status,
            super::NetworkRateStatus::Unavailable
        );
        assert_eq!(stats.networks[0].rx_bytes_per_sec, 0.0);
    }

    #[test]
    fn network_rate_warms_up_without_a_previous_counter() {
        let now = Instant::now();
        let previous = network_sample(&[], now);
        let mut stats = network_stats(&["eth0"]);

        super::apply_network_rates(
            &previous,
            Duration::from_secs(3),
            &network_sample(&[("eth0", 1_000, 1_000)], now).networks,
            &mut stats,
        );

        assert_eq!(
            stats.networks[0].rate_status,
            super::NetworkRateStatus::WarmingUp
        );
        assert_eq!(stats.networks[0].rx_bytes_per_sec, 0.0);
    }
}
