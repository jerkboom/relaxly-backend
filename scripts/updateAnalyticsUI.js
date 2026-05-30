const fs = require('fs');
const path = 'C:\\Users\\HP\\Desktop\\admin-frontend\\src\\features\\analytics\\AnalyticsCenter.tsx';
let content = fs.readFileSync(path, 'utf8');

// Add new imports
const importPattern = "import { useDashboardStats } from '@/hooks/api/useDashboard';";
if (!content.includes('useTrafficAnalytics')) {
  content = content.replace(importPattern, "import { useDashboardStats, useTrafficAnalytics, useRevenueAnalytics, useConversionFunnels } from '@/hooks/api/useDashboard';\nimport { analyticsService } from '@/services/analyticsService';");
}

// Update component to use new hooks
const hooksInsertionPattern = "const { data: payoutQueue = [], isLoading: queueLoading } = usePayoutQueue();";
if (!content.includes('const { data: traffic } = useTrafficAnalytics(timeRange);')) {
  content = content.replace(hooksInsertionPattern, `${hooksInsertionPattern}

  const { data: traffic, isLoading: trafficLoading } = useTrafficAnalytics(timeRange);
  const { data: revenueChart, isLoading: revenueLoading } = useRevenueAnalytics(timeRange);
  const { data: funnels, isLoading: funnelsLoading } = useConversionFunnels(timeRange);

  const handleExport = async () => {
    try {
      toast.loading('Exporting analytics...', { id: 'export-analytics' });
      const res = await analyticsService.exportAnalytics(timeRange);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', \`analytics-export-\${new Date().toISOString().split('T')[0]}.csv\`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Analytics exported successfully', { id: 'export-analytics' });
    } catch (e) {
      toast.error('Failed to export analytics', { id: 'export-analytics' });
    }
  };
`);
}

// Hook up export button
content = content.replace(/onClick=\{\(\) => toast\.success\('Exporting real-time report\.\.\.'\)\}/g, "onClick={handleExport}");

// Fix Traffic Trends chart
const trafficDataPattern = "const trafficData = stats?.trafficData || [];";
content = content.replace(trafficDataPattern, "const trafficData = traffic?.dailyTraffic || [];");

// Fix Unique Visitors card
const uniqueVisitorsPattern = "stats?.visitors?.total?.toLocaleString()";
content = content.replace(uniqueVisitorsPattern, "traffic?.uniqueVisitors?.toLocaleString()");

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated AnalyticsCenter.tsx');
