import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, ChevronRight, TrendingUp, BookOpen, BarChart2 } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/backendClient';

interface Exam {
  id: string;
  title: string;
  status: string;
  subject: { name: string; color: string } | null;
  level: { name: string } | null;
}

interface Submission {
  id: string;
  exam: { title: string; subject: { name: string } | null } | null;
  student: { full_name: string; email: string } | null;
}

const Dashboard = () => {
  const { user, isProfesseur } = useAuth();
  const [stats, setStats] = useState({
    averageScore: 0,
    successRate: 0,
    activeExams: 0,
  });
  const [pendingCorrections, setPendingCorrections] = useState<Submission[]>([]);
  const [recentExams, setRecentExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!user) return;

      try {
        // Fetch exams
        const { data: examsData } = await supabase
          .from('exams')
          .select(`
            id,
            title,
            status,
            subject:subjects(name, color),
            level:levels(name)
          `)
          .order('created_at', { ascending: false })
          .limit(6);

        if (examsData) {
          setRecentExams(examsData as unknown as Exam[]);
          setStats(prev => ({
            ...prev,
            activeExams: examsData.filter(e => e.status === 'publie').length
          }));
        }

        // Fetch pending corrections
        if (isProfesseur) {
          const { data: submissionsData } = await supabase
            .from('submissions')
            .select(`
              id,
              exam:exams(title, subject:subjects(name)),
              student:profiles!submissions_student_id_fkey(full_name, email)
            `)
            .in('status', ['soumis', 'corrige_auto'])
            .limit(5);

          if (submissionsData) {
            setPendingCorrections(submissionsData as unknown as Submission[]);
          }
        }

        // Calculate stats
        const { data: completedSubmissions } = await supabase
          .from('submissions')
          .select('score')
          .not('score', 'is', null);

        if (completedSubmissions && completedSubmissions.length > 0) {
          const total = completedSubmissions.reduce((acc, s) => acc + (s.score || 0), 0);
          const avg = total / completedSubmissions.length;
          const passing = completedSubmissions.filter(s => (s.score || 0) >= 10).length;
          
          setStats(prev => ({
            ...prev,
            averageScore: Math.round(avg * 10) / 10,
            successRate: Math.round((passing / completedSubmissions.length) * 100),
          }));
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user, isProfesseur]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'publie':
        return <Badge className="bg-success/20 text-success border-0">Publié</Badge>;
      case 'brouillon':
        return <Badge className="bg-warning/20 text-warning border-0">Brouillon</Badge>;
      case 'corrige':
        return <Badge className="bg-primary/20 text-primary border-0">Corrigé</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <AppLayout title="Tableau de Bord">
      <div className="space-y-6 animate-fade-in">

        {/* Welcome */}
        <div className="bg-card rounded-xl p-6 shadow-card border border-border">
          <h2 className="text-xl font-bold text-foreground">
            Bonjour{isProfesseur ? ', Professeur' : ''}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isProfesseur
              ? 'Gerez vos epreuves et suivez les performances de vos etudiants.'
              : 'Consultez vos epreuves a venir et vos resultats.'}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl p-5 shadow-card text-white" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/80 font-medium">Note Moyenne</p>
                <p className="text-3xl font-bold mt-1">{stats.averageScore}<span className="text-base font-normal text-white/70">/20</span></p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
                <BarChart2 className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${(stats.averageScore / 20) * 100}%` }} />
            </div>
          </div>

          <div className="rounded-xl p-5 shadow-card text-white" style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/80 font-medium">Taux de Reussite</p>
                <p className="text-3xl font-bold mt-1">{stats.successRate}<span className="text-base font-normal text-white/70">%</span></p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${stats.successRate}%` }} />
            </div>
          </div>

          <div className="rounded-xl p-5 shadow-card text-white" style={{ background: 'linear-gradient(135deg, #10b981, #34d399)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/80 font-medium">Epreuves Actives</p>
                <p className="text-3xl font-bold mt-1">{stats.activeExams}</p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-white/70 mt-3">
              {stats.activeExams === 0 ? 'Aucune epreuve publiee' : `${stats.activeExams} epreuve${stats.activeExams > 1 ? 's' : ''} en cours`}
            </p>
          </div>
        </div>

        {/* Corrections en attente */}
        {isProfesseur && pendingCorrections.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold text-foreground">Corrections en attente</h3>
              <Badge variant="secondary" className="text-[10px] h-5 font-semibold">{pendingCorrections.length}</Badge>
            </div>
            <div className="space-y-2">
              {pendingCorrections.map((submission) => (
                <Card key={submission.id} className="border shadow-card hover:shadow-card-hover transition-shadow">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-warning" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{submission.exam?.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{submission.student?.full_name || submission.student?.email}</p>
                      </div>
                    </div>
                    <Link to={`/corrections/${submission.id}`} className="flex-shrink-0">
                      <Button size="sm" className="text-xs h-8 px-4">Corriger</Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Epreuves */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {isProfesseur ? 'Epreuves Creees' : 'Epreuves Disponibles'}
            </h3>
            {isProfesseur && (
              <Link to="/exams/create">
                <Button size="sm" className="text-xs h-8 px-4 gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Nouvelle
                </Button>
              </Link>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentExams.map((exam) => (
              <Link key={exam.id} to={isProfesseur ? `/exams/${exam.id}/submissions` : '/my-exams'}>
                <Card className="border shadow-card hover:shadow-card-hover transition-all group cursor-pointer h-full">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{
                          backgroundColor: exam.subject?.color ? `${exam.subject.color}15` : 'hsl(var(--primary) / 0.1)',
                          color: exam.subject?.color || 'hsl(var(--primary))',
                        }}
                      >
                        {exam.subject?.name?.charAt(0).toUpperCase() || 'E'}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                        {exam.title}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {exam.level?.name}{exam.subject?.name ? ` - ${exam.subject.name}` : ''}
                      </p>
                    </div>
                    {getStatusBadge(exam.status)}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </AppLayout>
  );
};

export default Dashboard;



import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Dashboard() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await api.get("/auth/me", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });

        setUser(res.data);
      } catch (err) {
        console.log(err);
      }
    };

    fetchUser();
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {user ? <p>Bienvenue {user.email}</p> : <p>Chargement...</p>}
    </div>
  );
}
