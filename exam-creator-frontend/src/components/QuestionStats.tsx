// Composant qui calcule et affiche des statistiques de performance pour chaque question.
// Utile pour identifier les questions les plus difficiles et les points faibles des étudiants.
import { useEffect, useState } from 'react';
import { BarChart3, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '@/lib/backendClient';
import { useLanguage } from '@/hooks/useLanguage';

interface QuestionStat {
  questionId: string;
  questionText: string;
  questionType: string;
  totalAnswers: number;
  correctAnswers: number;
  avgPoints: number;
  maxPoints: number;
  successRate: number;
}

interface QuestionStatsProps {
  examId: string;
}

const QuestionStats = ({ examId }: QuestionStatsProps) => {
  const { t } = useLanguage();
  const [stats, setStats] = useState<QuestionStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch exam questions
        const { data: eqData } = await supabase
          .from('exam_questions')
          .select('id, question_id, points, question:questions(id, question_text, question_type, points)')
          .eq('exam_id', examId)
          .order('order_index');

        if (!eqData || eqData.length === 0) {
          setLoading(false);
          return;
        }

        // Fetch all submissions for this exam
        const { data: subsData } = await supabase
          .from('submissions')
          .select('id')
          .eq('exam_id', examId)
          .in('status', ['soumis', 'corrige_auto', 'corrige']);

        if (!subsData || subsData.length === 0) {
          setLoading(false);
          return;
        }

        const subIds = subsData.map(s => s.id);

        // Fetch all answers for these submissions
        const { data: answersData } = await supabase
          .from('answers')
          .select('question_id, is_correct, points_awarded')
          .in('submission_id', subIds);

        // Build stats per question
        const answersByQ = new Map<string, { correct: number; total: number; pointsSum: number }>();
        (answersData || []).forEach((a: any) => {
          const current = answersByQ.get(a.question_id) || { correct: 0, total: 0, pointsSum: 0 };
          current.total += 1;
          if (a.is_correct) current.correct += 1;
          current.pointsSum += (a.points_awarded || 0);
          answersByQ.set(a.question_id, current);
        });

        const questionStats: QuestionStat[] = (eqData as any[]).map(eq => {
          const q = eq.question as any;
          const qId = eq.question_id;
          const agg = answersByQ.get(qId) || { correct: 0, total: 0, pointsSum: 0 };
          const maxPts = eq.points || q?.points || 1;
          return {
            questionId: qId,
            questionText: q?.question_text || '',
            questionType: q?.question_type || '',
            totalAnswers: agg.total,
            correctAnswers: agg.correct,
            avgPoints: agg.total > 0 ? Math.round((agg.pointsSum / agg.total) * 100) / 100 : 0,
            maxPoints: maxPts,
            successRate: agg.total > 0 ? Math.round((agg.correct / agg.total) * 100) : 0,
          };
        });

        setStats(questionStats);
      } catch (err) {
        console.error('Error fetching question stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [examId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (stats.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">{t('Aucune donnée disponible')}</p>;
  }

  // Sort by success rate ascending (worst first)
  const sorted = [...stats].sort((a, b) => a.successRate - b.successRate);

  return (
    <div className="space-y-3">
      {sorted.map((s, i) => {
        const isWeak = s.successRate < 40;
        const isMedium = s.successRate >= 40 && s.successRate < 70;
        return (
          <div key={s.questionId} className={`p-3 rounded-lg border ${isWeak ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-semibold text-primary">Q{i + 1}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                    {s.questionType === 'qcm' ? 'QCM' : s.questionType === 'vrai_faux' ? 'V/F' : s.questionType === 'reponse_courte' ? t('Courte') : t('Rédaction')}
                  </span>
                  {isWeak && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
                </div>
                <p className="text-sm text-foreground truncate">{s.questionText}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1">
                  {s.successRate >= 70 ? (
                    <CheckCircle className="w-4 h-4 text-success" />
                  ) : s.successRate < 40 ? (
                    <XCircle className="w-4 h-4 text-destructive" />
                  ) : null}
                  <span className={`text-lg font-bold ${isWeak ? 'text-destructive' : isMedium ? 'text-warning' : 'text-success'}`}>
                    {s.successRate}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.correctAnswers}/{s.totalAnswers} {t('correct')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('Moy.')} {s.avgPoints}/{s.maxPoints} pts
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isWeak ? 'bg-destructive' : isMedium ? 'bg-warning' : 'bg-success'}`}
                style={{ width: `${s.successRate}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default QuestionStats;
