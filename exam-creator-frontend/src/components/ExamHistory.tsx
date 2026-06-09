// Composant d'affichage de l'historique des modifications d'un examen.
// Il agrège les audit logs liés à l'examen, aux questions et aux sections.
import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/backendClient';
import { useLanguage } from '@/hooks/useLanguage';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface AuditEntry {
  id: string;
  user_email: string;
  action: string;
  table_name: string;
  changes: any;
  created_at: string;
}

interface ExamHistoryProps {
  examId: string;
}

const ExamHistory = ({ examId }: ExamHistoryProps) => {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      // Fetch audit logs for this exam (exams table + exam_questions + exam_parts)
      const { data } = await supabase
        .from('audit_logs')
        .select('id, user_email, action, table_name, changes, created_at')
        .eq('row_id', examId)
        .in('table_name', ['exams', 'exam_questions', 'exam_parts'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (data) setEntries(data as unknown as AuditEntry[]);
      setLoading(false);
    };
    if (examId) fetchHistory();
  }, [examId]);

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'insert':
        return <Badge className="bg-green-500/20 text-green-600 border-0 text-[10px]">{t('Création')}</Badge>;
      case 'update':
        return <Badge className="bg-blue-500/20 text-blue-600 border-0 text-[10px]">{t('Modification')}</Badge>;
      case 'delete':
        return <Badge className="bg-red-500/20 text-red-600 border-0 text-[10px]">{t('Suppression')}</Badge>;
      default:
        return <Badge variant="secondary" className="text-[10px]">{action}</Badge>;
    }
  };

  const describeChanges = (entry: AuditEntry): string => {
    if (!entry.changes) return '';
    try {
      const c = typeof entry.changes === 'string' ? JSON.parse(entry.changes) : entry.changes;
      if (entry.action === 'insert') {
        if (entry.table_name === 'exams') return t('Examen créé');
        if (entry.table_name === 'exam_questions') return t('Question ajoutée');
        if (entry.table_name === 'exam_parts') return t('Partie ajoutée');
      }
      if (entry.action === 'update' && c) {
        const keys = Object.keys(c).filter(k => k !== 'id' && k !== 'updated_at');
        if (keys.length === 0) return t('Mise à jour');
        const fieldNames: Record<string, string> = {
          title: t('Titre'),
          description: t('Description'),
          status: t('Statut'),
          total_points: t('Barème'),
          duration_minutes: t('Durée'),
          start_date: t('Date début'),
          end_date: t('Date fin'),
          subject_id: t('Matière'),
          level_id: t('Niveau'),
        };
        return keys.map(k => fieldNames[k] || k).join(', ');
      }
      if (entry.action === 'delete') {
        if (entry.table_name === 'exam_questions') return t('Question retirée');
        if (entry.table_name === 'exam_parts') return t('Partie supprimée');
        return t('Élément supprimé');
      }
    } catch {
      // ignore
    }
    return '';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {t('Aucun historique disponible')}
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <History className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground truncate">
                {entry.user_email}
              </span>
              {getActionBadge(entry.action)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {describeChanges(entry)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale: fr })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ExamHistory;
