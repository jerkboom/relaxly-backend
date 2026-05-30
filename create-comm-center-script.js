const fs = require('fs');
const content = `'use client';

import * as React from 'react';
import { 
  Send, 
  Users, 
  Mail, 
  MessageSquare, 
  BarChart3, 
  Plus, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  History,
  Layout,
  Filter,
  Search,
  Eye,
  Settings2,
  BellRing,
  MoreVertical,
  ArrowRight,
  Target,
  Smartphone,
  ShieldAlert
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@/services/notificationService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CommunicationCenter() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState('overview');
  const [isComposeOpen, setIsComposeOpen] = React.useState(false);

  // Queries
  const { data: statsData } = useQuery({
    queryKey: ['comm-stats'],
    queryFn: () => notificationService.getCommunicationStats(),
    refetchInterval: 10000
  });
  const stats = statsData?.data || statsData;

  const { data: campaignsData = [] } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => notificationService.getCampaigns()
  });
  const campaigns = campaignsData?.data || campaignsData || [];

  const { data: templatesData = [] } = useQuery({
    queryKey: ['msg-templates'],
    queryFn: () => notificationService.getTemplates()
  });
  const templates = templatesData?.data || templatesData || [];

  // State for new campaign
  const [newCampaign, setNewCampaign] = React.useState({
    name: '',
    templateId: '',
    audienceType: 'students',
    channels: ['dashboard'],
    priority: 'normal'
  });

  const createCampaignMutation = useMutation({
    mutationFn: (data: any) => notificationService.createCampaign(data),
    onSuccess: () => {
      toast.success('Campaign broadcast initiated');
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setIsComposeOpen(false);
      setActiveTab('campaigns');
    }
  });

  const handleCreateCampaign = () => {
    if (!newCampaign.name || !newCampaign.templateId) {
      toast.error('Please fill in all required fields');
      return;
    }
    createCampaignMutation.mutate({
      name: newCampaign.name,
      templateId: newCampaign.templateId,
      audience: { type: newCampaign.audienceType },
      channels: newCampaign.channels,
      priority: newCampaign.priority
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <PageHeader
        title="Broadcast Command Center"
        description="Unified engine for platform-wide announcements, targeted campaigns, and emergency alerts."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Communication' }]}
        action={
          <Button className="bg-slate-900 font-black shadow-xl shadow-slate-200" onClick={() => setIsComposeOpen(true)}>
             <Plus className="mr-2 h-4 w-4" /> New Broadcast
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
        <div className="flex items-center justify-between bg-white p-1 rounded-2xl border shadow-sm ring-1 ring-slate-100">
          <TabsList className="bg-transparent gap-1 border-none">
            <TabsTrigger value="overview" className="rounded-xl data-[state=active]:bg-primary/5 data-[state=active]:text-primary font-bold px-6 py-2.5">
               <BarChart3 className="mr-2 h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="rounded-xl data-[state=active]:bg-primary/5 data-[state=active]:text-primary font-bold px-6 py-2.5">
               <History className="mr-2 h-4 w-4" /> Campaigns
            </TabsTrigger>
            <TabsTrigger value="templates" className="rounded-xl data-[state=active]:bg-primary/5 data-[state=active]:text-primary font-bold px-6 py-2.5">
               <Layout className="mr-2 h-4 w-4" /> Templates
            </TabsTrigger>
          </TabsList>
          
          <div className="px-4 border-l flex items-center gap-4">
             <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-[10px] font-black uppercase text-slate-500">Live Delivery Active</span>
             </div>
          </div>
        </div>

        <TabsContent value="overview" className="space-y-8 m-0 animate-in slide-in-from-left-2 duration-500">
          {/* STATS CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
             <Card className="border-none shadow-sm ring-1 ring-slate-100">
                <CardContent className="p-6">
                   <div className="flex items-center justify-between mb-4">
                      <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Send className="h-4 w-4" /></div>
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase border-emerald-100">Today</Badge>
                   </div>
                   <p className="text-3xl font-black text-slate-900">{stats?.totalSentToday || 0}</p>
                   <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-1">Messages Dispatched</p>
                </CardContent>
             </Card>
             <Card className="border-none shadow-sm ring-1 ring-slate-100">
                <CardContent className="p-6">
                   <div className="flex items-center justify-between mb-4">
                      <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Mail className="h-4 w-4" /></div>
                      <Badge variant="outline" className="text-[9px] font-black uppercase">Email</Badge>
                   </div>
                   <p className="text-3xl font-black text-slate-900">98.2%</p>
                   <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-1">Avg. Delivery Rate</p>
                </CardContent>
             </Card>
             <Card className="border-none shadow-sm ring-1 ring-slate-100">
                <CardContent className="p-6">
                   <div className="flex items-center justify-between mb-4">
                      <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><MessageSquare className="h-4 w-4" /></div>
                      <Badge variant="outline" className="text-[9px] font-black uppercase">Dashboard</Badge>
                   </div>
                   <p className="text-3xl font-black text-slate-900">450</p>
                   <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-1">Unread Alerts</p>
                </CardContent>
             </Card>
             <Card className="border-none shadow-sm bg-rose-50 ring-1 ring-rose-100">
                <CardContent className="p-6">
                   <div className="flex items-center justify-between mb-4">
                      <div className="p-2 bg-white text-rose-600 shadow-sm rounded-lg"><ShieldAlert className="h-4 w-4" /></div>
                   </div>
                   <p className="text-3xl font-black text-rose-900">{stats?.activeCampaigns || 0}</p>
                   <p className="text-[10px] text-rose-700 font-bold uppercase tracking-widest mt-1">Active Broadcasts</p>
                </CardContent>
             </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
             {/* RECENT CAMPAIGNS MINI-LIST */}
             <Card className="lg:col-span-2 border-none shadow-sm ring-1 ring-slate-100">
                <CardHeader className="border-b bg-muted/5">
                   <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-black uppercase tracking-widest">Active Delivery Streams</CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setActiveTab('campaigns')} className="text-xs font-bold text-primary">View All History <ArrowRight className="ml-1 h-3 w-3" /></Button>
                   </div>
                </CardHeader>
                <CardContent className="p-0">
                   <div className="divide-y">
                      {campaigns.slice(0, 5).map((c: any) => (
                         <div key={c._id} className="p-6 flex items-center justify-between hover:bg-muted/5 transition-colors">
                            <div className="flex items-center gap-5">
                               <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                                  {c.channels.includes('email') ? <Mail className="h-6 w-6" /> : <BellRing className="h-6 w-6" />}
                               </div>
                               <div>
                                  <h4 className="text-sm font-black text-slate-900">{c.name}</h4>
                                  <div className="flex items-center gap-3 mt-1">
                                     <span className="text-[10px] font-bold text-muted-foreground uppercase">{format(new Date(c.createdAt), 'MMM dd, HH:mm')}</span>
                                     <Separator orientation="vertical" className="h-2" />
                                     <span className="text-[10px] font-black text-primary uppercase">{c.audience.type}</span>
                                  </div>
                               </div>
                            </div>
                            <div className="flex items-center gap-8">
                               <div className="text-right space-y-1">
                                  <p className="text-xs font-black text-slate-900">{c.stats?.sentCount || 0} / {c.stats?.targetCount || 0}</p>
                                  <Progress value={((c.stats?.sentCount || 0) / (c.stats?.targetCount || 1)) * 100} className="w-24 h-1" />
                               </div>
                               <Badge className={cn(
                                 "text-[9px] font-black uppercase h-5",
                                 c.status === 'completed' ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-blue-50 text-blue-700 border-blue-100"
                               )} variant="outline">
                                  {c.status}
                               </Badge>
                            </div>
                         </div>
                      ))}
                      {campaigns.length === 0 && (
                        <div className="p-12 text-center text-slate-400 font-medium italic">No active broadcasts</div>
                      )}
                   </div>
                </CardContent>
             </Card>

             {/* CHANNEL HEALTH */}
             <Card className="border-none shadow-sm ring-1 ring-slate-100">
                <CardHeader>
                   <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-500">Channel Integrity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                   <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-100 space-y-3">
                      <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span className="text-xs font-bold text-emerald-900">SMTP Gateway</span>
                         </div>
                         <Badge className="bg-emerald-500 text-white text-[8px] h-4">OPERATIONAL</Badge>
                      </div>
                      <p className="text-[10px] text-emerald-700/70 font-medium leading-relaxed">System is communicating normally with primary mail server.</p>
                   </div>

                   <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-100 space-y-3">
                      <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-blue-600" />
                            <span className="text-xs font-bold text-blue-900">Socket Gateway</span>
                         </div>
                         <Badge className="bg-blue-500 text-white text-[8px] h-4">ACTIVE</Badge>
                      </div>
                      <p className="text-[10px] text-blue-700/70 font-medium leading-relaxed">Real-time notification socket is synchronized with 142 clients.</p>
                   </div>

                   <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3 opacity-60">
                      <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                            <Smartphone className="h-4 w-4 text-slate-600" />
                            <span className="text-xs font-bold text-slate-900">SMS / Hubtel</span>
                         </div>
                         <Badge className="bg-slate-400 text-white text-[8px] h-4">IDLE</Badge>
                      </div>
                      <p className="text-[10px] text-slate-600 font-medium leading-relaxed">SMS gateway is configured but no pending queue.</p>
                   </div>
                </CardContent>
             </Card>
          </div>
        </TabsContent>

        <TabsContent value="campaigns" className="m-0 animate-in slide-in-from-right-2 duration-500">
           <Card className="border-none shadow-sm ring-1 ring-slate-100">
              <CardContent className="p-0">
                 <div className="p-4 border-b flex items-center justify-between">
                    <div className="relative w-72">
                       <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground opacity-50" />
                       <Input placeholder="Search campaigns..." className="pl-10 h-10 rounded-xl" />
                    </div>
                    <Button variant="outline" size="sm" className="rounded-xl"><Filter className="mr-2 h-4 w-4" /> Filters</Button>
                 </div>
                 <div className="divide-y">
                    {campaigns.map((c: any) => (
                       <div key={c._id} className="p-6 flex items-center justify-between hover:bg-muted/5 transition-colors">
                          <div className="flex items-center gap-6">
                             <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 border shadow-sm">
                                {c.channels.includes('email') ? <Mail className="h-7 w-7" /> : <BellRing className="h-7 w-7" />}
                             </div>
                             <div>
                                <h4 className="text-base font-black text-slate-900">{c.name}</h4>
                                <div className="flex items-center gap-3 mt-1">
                                   <span className="text-[11px] font-bold text-muted-foreground uppercase">{format(new Date(c.createdAt), 'MMM dd, HH:mm')}</span>
                                   <Separator orientation="vertical" className="h-3" />
                                   <div className="flex gap-1">
                                      {c.channels.map((ch: string) => (
                                         <Badge key={ch} variant="outline" className="text-[8px] h-4 uppercase">{ch}</Badge>
                                      ))}
                                   </div>
                                </div>
                             </div>
                          </div>
                          <div className="flex items-center gap-12">
                             <div className="grid grid-cols-3 gap-8">
                                <div className="text-center">
                                   <p className="text-xs font-black text-slate-900">{c.stats?.targetCount || 0}</p>
                                   <p className="text-[9px] font-bold text-muted-foreground uppercase">Target</p>
                                </div>
                                <div className="text-center">
                                   <p className="text-xs font-black text-emerald-600">{c.stats?.sentCount || 0}</p>
                                   <p className="text-[9px] font-bold text-muted-foreground uppercase">Sent</p>
                                </div>
                                <div className="text-center">
                                   <p className="text-xs font-black text-rose-500">{c.stats?.failedCount || 0}</p>
                                   <p className="text-[9px] font-bold text-muted-foreground uppercase">Failed</p>
                                </div>
                             </div>
                             <Badge className={cn(
                               "text-[10px] font-black uppercase h-6 px-3",
                               c.status === 'completed' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"
                             )} variant="outline">
                                {c.status}
                             </Badge>
                             <Button variant="ghost" size="icon" className="rounded-full"><MoreVertical className="h-4 w-4" /></Button>
                          </div>
                       </div>
                    ))}
                 </div>
              </CardContent>
           </Card>
        </TabsContent>
      </Tabs>

      {/* COMPOSE DIALOG */}
      <Dialog open={isComposeOpen} onOpenChange={setIsComposeOpen}>
        <DialogContent className="max-w-3xl rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
          <DialogHeader className="p-8 bg-slate-900 text-white">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center border border-white/10">
                <Send className="h-6 w-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black uppercase tracking-tight">Broadcast Message</DialogTitle>
                <DialogDescription className="text-slate-400 text-xs">Dispatch multi-channel communication to platform segments.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-8 grid md:grid-cols-2 gap-8 bg-white">
             <div className="space-y-6">
                <div className="space-y-2">
                   <Label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Campaign Name</Label>
                   <Input 
                      placeholder="e.g. June Maintenance Alert" 
                      className="rounded-xl border-slate-200"
                      value={newCampaign.name}
                      onChange={(e) => setNewCampaign({...newCampaign, name: e.target.value})}
                   />
                </div>

                <div className="space-y-2">
                   <Label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Target Audience</Label>
                   <Select value={newCampaign.audienceType} onValueChange={(v) => setNewCampaign({...newCampaign, audienceType: v})}>
                      <SelectTrigger className="rounded-xl h-11">
                         <SelectValue placeholder="Select Audience" />
                      </SelectTrigger>
                      <SelectContent>
                         <SelectItem value="all">All Registered Users</SelectItem>
                         <SelectItem value="students">All Students</SelectItem>
                         <SelectItem value="owners">All Hostel Owners</SelectItem>
                         <SelectItem value="segment">Custom Segment</SelectItem>
                      </SelectContent>
                   </Select>
                </div>

                <div className="space-y-2">
                   <Label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Message Template</Label>
                   <Select value={newCampaign.templateId} onValueChange={(v) => setNewCampaign({...newCampaign, templateId: v})}>
                      <SelectTrigger className="rounded-xl h-11">
                         <SelectValue placeholder="Choose a pre-built template" />
                      </SelectTrigger>
                      <SelectContent>
                         {templates.map((t: any) => (
                            <SelectItem key={t._id} value={t._id}>{t.name} ({t.type})</SelectItem>
                         ))}
                         {templates.length === 0 && (
                            <SelectItem value="none" disabled>No templates available</SelectItem>
                         )}
                      </SelectContent>
                   </Select>
                </div>
             </div>

             <div className="space-y-6">
                <div className="space-y-2">
                   <Label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Distribution Channels</Label>
                   <div className="grid grid-cols-2 gap-3">
                      <Button 
                        variant="outline" 
                        className={cn("justify-start rounded-xl h-11 font-bold", newCampaign.channels.includes('dashboard') && "border-primary bg-primary/5 text-primary")}
                        onClick={() => setNewCampaign({
                          ...newCampaign, 
                          channels: newCampaign.channels.includes('dashboard') ? newCampaign.channels.filter(c => c !== 'dashboard') : [...newCampaign.channels, 'dashboard']
                        })}
                      >
                         <BellRing className="mr-2 h-4 w-4" /> Dashboard
                      </Button>
                      <Button 
                        variant="outline" 
                        className={cn("justify-start rounded-xl h-11 font-bold", newCampaign.channels.includes('email') && "border-primary bg-primary/5 text-primary")}
                        onClick={() => setNewCampaign({
                          ...newCampaign, 
                          channels: newCampaign.channels.includes('email') ? newCampaign.channels.filter(c => c !== 'email') : [...newCampaign.channels, 'email']
                        })}
                      >
                         <Mail className="mr-2 h-4 w-4" /> Email
                      </Button>
                   </div>
                </div>

                <div className="p-6 rounded-2xl bg-muted/20 border border-dashed space-y-4">
                   <h5 className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                      <Target className="h-4 w-4 text-primary" /> Delivery Preview
                   </h5>
                   <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                         <span className="text-muted-foreground">Est. Recipients</span>
                         <span className="font-bold">142 Users</span>
                      </div>
                      <div className="flex justify-between text-xs">
                         <span className="text-muted-foreground">Est. Latency</span>
                         <span className="font-bold">~15 Seconds</span>
                      </div>
                      <div className="flex justify-between text-xs">
                         <span className="text-muted-foreground">Priority Level</span>
                         <Badge variant="outline" className="text-[8px] h-4 font-black border-slate-300">NORMAL</Badge>
                      </div>
                   </div>
                </div>
             </div>
          </div>

          <DialogFooter className="p-8 bg-slate-50 border-t">
             <Button variant="ghost" className="font-bold rounded-xl" onClick={() => setIsComposeOpen(false)}>Cancel</Button>
             <Button className="bg-primary font-black px-12 rounded-xl shadow-lg shadow-primary/20" onClick={handleCreateCampaign} disabled={createCampaignMutation.isPending}>
                {createCampaignMutation.isPending ? "Executing Broadcast..." : "Launch Campaign"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode, className?: string }) {
  return <label className={cn("text-xs font-bold text-slate-700", className)}>{children}</label>;
}
`;

const path = 'C:\\\\Users\\\\HP\\\\Desktop\\\\admin-frontend\\\\src\\\\features\\\\communications\\\\CommunicationCenter.tsx';
fs.writeFileSync(path, content, 'utf8');
console.log('Successfully created CommunicationCenter feature');
`;

const scriptPath = 'create-comm-center.js';
fs.writeFileSync(scriptPath, content, 'utf8');
