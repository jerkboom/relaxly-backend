const fs = require('fs');
const path = require('path');

const analyticsServicePath = 'C:\\Users\\HP\\Desktop\\admin-frontend\\src\\services\\analyticsService.ts';

const analyticsServiceContent = `import api from '@/lib/api/client';

export const analyticsService = {
  async getDashboardAnalytics(timeframe: string = 'last30days'): Promise<any> {
    try {
      const response: any = await api.get(\`admin/analytics/overview?timeframe=\${timeframe}\`);
      return response || {};
    } catch (error) {
      console.error('[analyticsService] Failed to fetch dashboard analytics', error);
      throw error;
    }
  },

  async getTrafficAnalytics(timeframe: string = 'last30days'): Promise<any> {
    const res: any = await api.get(\`admin/analytics/traffic?timeframe=\${timeframe}\`);
    return res || {};
  },

  async getRevenueAnalytics(timeframe: string = 'last30days'): Promise<any> {
    const res: any = await api.get(\`admin/analytics/revenue?timeframe=\${timeframe}\`);
    return res || [];
  },

  async getConversionFunnels(timeframe: string = 'last30days'): Promise<any> {
    const res: any = await api.get(\`admin/analytics/funnels?timeframe=\${timeframe}\`);
    return res || [];
  },

  async exportAnalytics(timeframe: string = 'last30days'): Promise<any> {
    const res: any = await api.get(\`admin/analytics/export?timeframe=\${timeframe}\`, { responseType: 'blob' });
    return res;
  }
};
`;

fs.writeFileSync(analyticsServicePath, analyticsServiceContent, 'utf8');

const useDashboardPath = 'C:\\Users\\HP\\Desktop\\admin-frontend\\src\\hooks\\api\\useDashboard.ts';

const useDashboardContent = `import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '@/services/analyticsService';
import { hostelService } from '@/services/hostelService';

export function useDashboardStats(timeframe: string = 'last30days') {
  return useQuery({
    queryKey: ['dashboard-stats', timeframe],
    queryFn: () => analyticsService.getDashboardAnalytics(timeframe as any),
  });
}

export function useRecentHostelSubmissions() {
  return useQuery({
    queryKey: ['recent-hostels'],
    queryFn: () => hostelService.getPendingHostels(),
  });
}

export function useTrafficAnalytics(timeframe: string = 'last30days') {
  return useQuery({
    queryKey: ['traffic-analytics', timeframe],
    queryFn: () => analyticsService.getTrafficAnalytics(timeframe),
  });
}

export function useRevenueAnalytics(timeframe: string = 'last30days') {
  return useQuery({
    queryKey: ['revenue-analytics', timeframe],
    queryFn: () => analyticsService.getRevenueAnalytics(timeframe),
  });
}

export function useConversionFunnels(timeframe: string = 'last30days') {
  return useQuery({
    queryKey: ['conversion-funnels', timeframe],
    queryFn: () => analyticsService.getConversionFunnels(timeframe),
  });
}
`;

fs.writeFileSync(useDashboardPath, useDashboardContent, 'utf8');

console.log('Successfully updated frontend service and hooks');
