class SystemMonitor {
  constructor() {
    this.latencies = [];
    this.maxLatencySamples = 100;
    this.workerStatus = {
      payouts: 'Idle',
      expiry: 'Running',
      emailQueue: 'Idle'
    };
    this.anomalies = [];
    this.startTime = Date.now();
  }

  recordLatency(ms) {
    this.latencies.push(ms);
    if (this.latencies.length > this.maxLatencySamples) {
      this.latencies.shift();
    }
  }

  getAverageLatency() {
    if (this.latencies.length === 0) return 0;
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencies.length);
  }

  getP95Latency() {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return Math.round(sorted[index]);
  }

  setWorkerStatus(worker, status) {
    if (this.workerStatus[worker]) {
      this.workerStatus[worker] = status;
    }
  }

  getWorkerStatus() {
    return this.workerStatus;
  }

  recordAnomaly(type, message, severity = 'warning') {
    const anomaly = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      type,
      message,
      severity,
      time: new Date()
    };
    this.anomalies.unshift(anomaly);
    if (this.anomalies.length > 50) {
      this.anomalies.pop();
    }
  }

  getRecentAnomalies(limit = 10) {
    return this.anomalies.slice(0, limit);
  }
}

module.exports = new SystemMonitor();
