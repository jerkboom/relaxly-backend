const fs = require('fs');
const path = 'C:\\Users\\HP\\Desktop\\admin-frontend\\src\\features\\analytics\\AnalyticsCenter.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace mock financeChartData with real data
const oldChartData = `const financeChartData = React.useMemo(() => {
    // Generate last 7 days mockup distribution based on real totals to satisfy chart requirements
    // In a real app, this would use the ledger aggregation APIs
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const dayName = format(d, 'MMM dd');
      // Simulated distribution from the actual summary amounts
      const randomFactor = Math.random() * 0.5 + 0.5; // 0.5 to 1.0

      data.push({
        date: dayName,
        revenue: (financeSummary?.grossRevenue || 0) * 0.1 * randomFactor,
        payouts: (financeSummary?.paidPayouts || 0) * 0.1 * randomFactor,
        commission: (financeSummary?.platformRevenue || 0) * 0.1 * randomFactor
      });
    }
    return data;
  }, [financeSummary]);`;

const newChartData = `const financeChartData = React.useMemo(() => {
    if (!revenueChart || revenueChart.length === 0) return [];
    return revenueChart.map((item: any) => ({
      date: item.date,
      revenue: item.grossRevenue,
      commission: item.platformRevenue,
      payouts: 0 // Simplification: we don't have historical payout trends yet, so we plot revenue & commission
    }));
  }, [revenueChart]);`;

if (content.includes(oldChartData)) {
    content = content.replace(oldChartData, newChartData);
    console.log('Replaced finance chart data');
}

// Find if conversionFunnel is hardcoded in traffic tab
// Wait, I need to check where conversionFunnel is used.
fs.writeFileSync(path, content, 'utf8');
