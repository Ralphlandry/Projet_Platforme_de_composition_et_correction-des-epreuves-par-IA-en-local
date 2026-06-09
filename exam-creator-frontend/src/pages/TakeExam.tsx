// Page de passation d'examen. Gère le chargement, la sauvegarde automatique,
// le chronomètre et les règles anti-triche côté client.
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Clock, Send, AlertTriangle, Maximize, Shield } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/backendClient';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Question {
  id: string;
  question_text: string;
  question_type: string;
  options: unknown;
  points: number | null;
}

interface ExamQuestion {
  id: string;
  question_id: string;
  order_index: number | null;
  points: number | null;
  part?: {
    id: string;
    title: string;
    subtitle?: string | null;
    description?: string | null;
    order_index?: number | null;
  } | null;
  question: Question;
}

interface Exam {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  total_points: number | null;
  start_date: string | null;
  end_date: string | null;
}

// Composant principal de la page de passation.
// Il se charge de l'état de l'examen, des réponses et de la logique de soumission.
const TakeExam = () => {
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submission, setSubmission] = useState<{ id: string; started_at: string } | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showFullscreenWarning, setShowFullscreenWarning] = useState(false);
  const [showTimeExpiredDialog, setShowTimeExpiredDialog] = useState(false);
  const [timeExpiredCountdown, setTimeExpiredCountdown] = useState(10);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [networkIncidentCount, setNetworkIncidentCount] = useState(0);
  const networkIncidentsRef = useRef<Array<{ event: string; at: string }>>([]);
  const fullscreenActiveRef = useRef(false);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Références des cartes de questions pour la navigation par numéro
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Refs stables pour les event listeners (anti-triche + timer)
  const answersRef = useRef<Record<string, string>>({});
  const submissionRef = useRef<{ id: string; started_at: string } | null>(null);
  const submittingRef = useRef(false);
  const questionsRef = useRef<ExamQuestion[]>([]);
  const performSubmitRef = useRef<((isAutoSubmit?: boolean) => Promise<void>) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiredCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warned5minRef = useRef(false);
  const warned1minRef = useRef(false);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { submissionRef.current = submission; }, [submission]);
  useEffect(() => { submittingRef.current = submitting; }, [submitting]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  useEffect(() => {
    fetchExamData();
  }, [id, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer : démarre dès que submission ET timeLeft sont tous les deux prêts
  // timerRef empêche la création d'un second interval si l'effet est rejouer
  useEffect(() => {
    if (!submission || timeLeft <= 0 || timerRef.current) return;

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1;

        // Avertissement à 5 minutes
        if (next === 300 && !warned5minRef.current) {
          warned5minRef.current = true;
          toast.warning(t('Il vous reste 5 minutes !'));
        }
        // Avertissement à 1 minute
        if (next === 60 && !warned1minRef.current) {
          warned1minRef.current = true;
          toast.error(t('Plus qu\'une minute ! Soumettez vos réponses.'), { duration: 15000 });
        }

        if (next <= 0) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          // Afficher le dialog de compte à rebours au lieu de soumettre directement
          setShowTimeExpiredDialog(true);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [submission, timeLeft]);

  // Compte à rebours de 10s dans le dialog "temps écoulé"
  useEffect(() => {
    if (!showTimeExpiredDialog) return;
    setTimeExpiredCountdown(10);
    expiredCountdownRef.current = setInterval(() => {
      setTimeExpiredCountdown(prev => {
        if (prev <= 1) {
          if (expiredCountdownRef.current) {
            clearInterval(expiredCountdownRef.current);
            expiredCountdownRef.current = null;
          }
          performSubmitRef.current?.(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (expiredCountdownRef.current) {
        clearInterval(expiredCountdownRef.current);
        expiredCountdownRef.current = null;
      }
    };
  }, [showTimeExpiredDialog]);

  const fetchExamData = async () => {
    if (!id || !user) return;

    try {
      // Fetch exam details
      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('id, title, description, duration_minutes, total_points, start_date, end_date')
        .eq('id', id)
        .single();

      if (examError) throw examError;

      // Vérifier le créneau horaire défini par le professeur
      const now = new Date();
      if (examData.start_date && now < new Date(examData.start_date)) {
        const start = new Date(examData.start_date).toLocaleString('fr-FR');
        toast.error(t("Cette épreuve n'est pas encore ouverte. Elle commence le") + ` ${start}`);
        navigate('/my-exams');
        return;
      }
      if (examData.end_date && now > new Date(examData.end_date)) {
        // Créer une soumission vide avec score 0 si pas encore soumis
        const { data: alreadySubmitted } = await supabase
          .from('submissions')
          .select('id')
          .eq('exam_id', id)
          .eq('student_id', user.id)
          .in('status', ['soumis', 'corrige_auto', 'corrige', 'en_cours'])
          .maybeSingle();
        if (!alreadySubmitted) {
          await supabase.from('submissions').insert({
            exam_id: id,
            student_id: user.id,
            status: 'soumis',
            score: 0,
            started_at: new Date().toISOString(),
            submitted_at: new Date().toISOString(),
          });
        }
        toast.error(t('Le délai de cette épreuve est dépassé. Vous ne pouvez plus composer.'));
        navigate('/my-exams');
        return;
      }

      setExam(examData);

      // Fetch exam questions
      const { data: questionsData, error: questionsError } = await supabase
        .from('exam_questions')
        .select(`
          id,
          question_id,
          order_index,
          points,
          part:exam_parts(id, title, subtitle, description, order_index),
          question:questions(id, question_text, question_type, options, points)
        `)
        .eq('exam_id', id)
        .order('order_index');

      if (questionsError) throw questionsError;
      setQuestions(questionsData || []);

      // Get or create submission
      const { data: existingSubmission, error: subError } = await supabase
        .from('submissions')
        .select('id, started_at')
        .eq('exam_id', id)
        .eq('student_id', user.id)
        .eq('status', 'en_cours')
        .maybeSingle();

      if (subError) throw subError;

      let activeSubmissionId = '';

      if (existingSubmission) {
        setSubmission(existingSubmission);
        activeSubmissionId = existingSubmission.id;
        // Temps restant = heure de fin de l'épreuve - maintenant
        const endTime = examData.end_date
          ? new Date(examData.end_date).getTime()
          : new Date(existingSubmission.started_at).getTime() + (examData.duration_minutes || 60) * 60 * 1000;
        const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
      } else {
        // Bloc: vérifier qu'il n'a pas déjà soumis
        const { data: submittedData } = await supabase
          .from('submissions')
          .select('id, status')
          .eq('exam_id', id)
          .eq('student_id', user.id)
          .in('status', ['soumis', 'corrige_auto', 'corrige'])
          .maybeSingle();

        if (submittedData) {
          toast.info(t('Vous avez déjà soumis cette épreuve'));
          navigate('/my-exams');
          return;
        }

        // Créer la soumission
        const { data: newSubmission, error: createError } = await supabase
          .from('submissions')
          .insert({
            exam_id: id,
            student_id: user.id,
            status: 'en_cours',
            started_at: new Date().toISOString(),
          })
          .select('id, started_at')
          .single();

        if (createError) throw createError;
        setSubmission(newSubmission);
        activeSubmissionId = newSubmission.id;
        // Temps restant = heure de fin - maintenant
        const endTime = examData.end_date
          ? new Date(examData.end_date).getTime()
          : Date.now() + (examData.duration_minutes || 60) * 60 * 1000;
        setTimeLeft(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
      }

      // --- Restauration après coupure de courant / rechargement ---
      // 1. localStorage = sauvegardé à chaque frappe → toujours plus récent
      // 2. DB         = checkpoint toutes les 30s   → peut être jusqu'à 30s en retard
      // Stratégie : on charge les deux et on prend le plus récent.

      let localDraft: Record<string, string> = {};
      let localSavedAt = 0;
      try {
        const raw = localStorage.getItem(`exam_draft_${activeSubmissionId}`);
        if (raw) {
          const draft = JSON.parse(raw) as { answers: Record<string, string>; savedAt: number };
          const ageMin = (Date.now() - draft.savedAt) / 60000;
          if (ageMin < 180 && draft.answers && Object.keys(draft.answers).length > 0) {
            localDraft = draft.answers;
            localSavedAt = draft.savedAt;
          }
        }
      } catch { /* ignore */ }

      const { data: existingAnswers } = await supabase
        .from('answers')
        .select('question_id, answer_text')
        .eq('submission_id', activeSubmissionId);

      const dbAnswers: Record<string, string> = {};
      if (existingAnswers) {
        existingAnswers.forEach(a => {
          if (a.question_id && a.answer_text) {
            dbAnswers[a.question_id] = a.answer_text;
          }
        });
      }

      // localStorage est plus récent → on part de la DB comme base, on écrase avec localStorage
      const savedAnswers: Record<string, string> = { ...dbAnswers };
      if (Object.keys(localDraft).length > 0) {
        Object.assign(savedAnswers, localDraft);
        const whenStr = new Date(localSavedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        toast.info(t('Réponses restaurées depuis votre appareil (sauvegarde de') + ` ${whenStr}).`, { duration: 6000 });
      } else if (Object.keys(dbAnswers).length > 0) {
        toast.info(t('Réponses précédentes rechargées.'), { duration: 3000 });
      }

      if (Object.keys(savedAnswers).length > 0) {
        setAnswers(savedAnswers);
        answersRef.current = savedAnswers;
      }
    } catch (error) {
      console.error('Error fetching exam:', error);
      toast.error(t("Erreur lors du chargement de l'épreuve"));
      navigate('/my-exams');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers(prev => {
      const next = { ...prev, [questionId]: value };
      answersRef.current = next;
      // Sauvegarde immédiate dans localStorage (protection coupure de courant)
      if (submissionRef.current?.id) {
        localStorage.setItem(
          `exam_draft_${submissionRef.current.id}`,
          JSON.stringify({ answers: next, savedAt: Date.now() })
        );
      }
      return next;
    });
  };

  // Sauvegarde silencieuse en base toutes les 30s
  const saveAnswersToDB = async () => {
    const sub = submissionRef.current;
    const ans = answersRef.current;
    const qs = questionsRef.current;
    if (!sub || submittingRef.current || Object.keys(ans).length === 0) return;
    try {
      const answersToUpsert = qs.map(eq => ({
        submission_id: sub.id,
        question_id: eq.question_id,
        answer_text: ans[eq.question_id] || null,
      }));
      await supabase.from('answers').delete().eq('submission_id', sub.id);
      await supabase.from('answers').insert(answersToUpsert);
      setLastSaved(new Date());
    } catch {
      // Silencieux — la sauvegarde locale reste disponible
    }
  };

  useEffect(() => {
    if (!submission) return;
    autoSaveRef.current = setInterval(saveAnswersToDB, 30000);
    return () => {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);

  // Détection de la connexion réseau
  useEffect(() => {
    const logIncident = (event: string) => {
      const entry = { event, at: new Date().toISOString() };
      networkIncidentsRef.current = [...networkIncidentsRef.current, entry];
      setNetworkIncidentCount(c => c + 1);
    };

    const handleOnline = () => {
      setIsOnline(true);
      logIncident('reconnexion');
      toast.success(
        '\u26a0\ufe0f ' + t('Changement de réseau détecté et enregistré dans votre copie. Synchronisation en cours\u2026'),
        { duration: 6000 }
      );
      // Sauvegarder immédiatement en DB dès le retour du réseau
      saveAnswersToDB();
    };
    const handleOffline = () => {
      setIsOnline(false);
      logIncident('déconnexion');
      toast.warning(
        '\u26a0\ufe0f ' + t('Déconnexion enregistrée \u2014 vos réponses sont sauvegardées localement.'),
        { duration: 8000 }
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fonction centrale de soumission — utilise des refs pour éviter les closures obsolètes
  const performSubmit = useCallback(async (isAutoSubmit = false) => {
    const sub = submissionRef.current;
    const ans = answersRef.current;
    const qs = questionsRef.current;

    if (!sub || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await supabase
        .from('answers')
        .delete()
        .eq('submission_id', sub.id);

      const answersToInsert = qs.map(eq => ({
        submission_id: sub.id,
        question_id: eq.question_id,
        answer_text: ans[eq.question_id] || null,
      }));

      const { error: answersError } = await supabase
        .from('answers')
        .insert(answersToInsert);

      if (answersError) throw answersError;

      const { error: updateError } = await supabase
        .from('submissions')
        .update({
          status: 'soumis',
          submitted_at: new Date().toISOString(),
        })
        .eq('id', sub.id);

      if (updateError) throw updateError;

      if (isAutoSubmit) {
        toast.warning(t('Épreuve soumise automatiquement — navigation externe détectée'));
      } else {
        toast.success(t('Épreuve soumise avec succès. Correction IA en cours...'));
      }

      // Déclencher la correction IA en arrière-plan (fire-and-forget)
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001';
      const token2 = (await supabase.auth.getSession()).data?.session?.access_token;

      // Inclure le journal réseau dans la soumission (visible par le professeur)
      if (networkIncidentsRef.current.length > 0) {
        await supabase
          .from('submissions')
          .update({ incidents: JSON.stringify(networkIncidentsRef.current) })
          .eq('id', sub.id);
      }

      // Nettoyer la sauvegarde locale — soumission réussie
      localStorage.removeItem(`exam_draft_${sub.id}`);
      if (autoSaveRef.current) clearInterval(autoSaveRef.current);

      navigate(`/exam-result/${sub.id}`);

      if (token2) {
        fetch(`${API_URL}/api/exams/submissions/${sub.id}/auto-correct`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token2}` },
        }).catch(() => {});
      }    } catch (error) {
      console.error('Error submitting exam:', error);
      toast.error(t('Erreur lors de la soumission'));
      submittingRef.current = false;
      setSubmitting(false);
    } finally {
      setShowConfirmDialog(false);
    }
  }, [navigate]);

  const handleSubmit = useCallback(() => {
    performSubmit(false);
  }, [performSubmit]);

  const handleExpiredSubmit = useCallback(() => {
    if (expiredCountdownRef.current) {
      clearInterval(expiredCountdownRef.current);
      expiredCountdownRef.current = null;
    }
    setShowTimeExpiredDialog(false);
    performSubmit(true);
  }, [performSubmit]);

  // Synchronise la ref avec la dernière version de performSubmit
  useEffect(() => {
    performSubmitRef.current = performSubmit;
  }, [performSubmit]);

  // Anti-triche : soumission automatique si l'étudiant quitte l'onglet
  useEffect(() => {
    if (!submission) return;
    let mobileAbsenceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Enregistrer l'événement dans les incidents (desktop + mobile)
        const entry = { event: 'quitte_application', at: new Date().toISOString() };
        networkIncidentsRef.current = [...networkIncidentsRef.current, entry];
        setNetworkIncidentCount(c => c + 1);

        if (isMobile) {
          // Sur mobile : attendre 30s avant de soumettre
          // Évite les faux positifs (appel entrant, notification) < 30s
          mobileAbsenceTimer = setTimeout(() => {
            performSubmitRef.current?.(true);
          }, 15000);
          toast.warning(t('⚠️ Sortie détectée — soumission automatique dans 15s si vous ne revenez pas.'), { duration: 8000 });
        } else {
          // Sur desktop : soumission automatique immédiate
          performSubmit(true);
        }
      } else if (document.visibilityState === 'visible') {
        if (isMobile && mobileAbsenceTimer) {
          // L'étudiant est revenu dans les 30s → annuler la soumission automatique
          clearTimeout(mobileAbsenceTimer);
          mobileAbsenceTimer = null;
          const entry = { event: 'retour_application', at: new Date().toISOString() };
          networkIncidentsRef.current = [...networkIncidentsRef.current, entry];
          setNetworkIncidentCount(c => c + 1);
          toast.info(t('Retour détecté — soumission automatique annulée.'), { duration: 4000 });
        } else if (isMobile) {
          // Retour après soumission déjà déclenchée ou sans timer actif
          const entry = { event: 'retour_application', at: new Date().toISOString() };
          networkIncidentsRef.current = [...networkIncidentsRef.current, entry];
          setNetworkIncidentCount(c => c + 1);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (mobileAbsenceTimer) clearTimeout(mobileAbsenceTimer);
    };
  }, [submission, performSubmit, isMobile]);

  // Anti-triche : soumission automatique si l'étudiant sort du plein écran
  useEffect(() => {
    if (!submission) return;
    const handleFullscreenChange = () => {
      const isFullscreen = !!(
        document.fullscreenElement ||
        (document as unknown as Record<string, unknown>).webkitFullscreenElement
      );
      if (!isFullscreen && fullscreenActiveRef.current) {
        // L'étudiant a quitté le plein écran volontairement
        performSubmitRef.current?.(true);
      }
      fullscreenActiveRef.current = isFullscreen;
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [submission]);

  // Anti-triche : bloquer capture d'écran, DevTools, copier, clic droit
  useEffect(() => {
    if (!submission) return;

    const logIncident = (event: string) => {
      const entry = { event, at: new Date().toISOString() };
      networkIncidentsRef.current = [...networkIncidentsRef.current, entry];
      setNetworkIncidentCount(c => c + 1);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Bloquer PrintScreen
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        logIncident('capture_ecran_tentative');
        toast.error(t('Les captures d\'écran sont interdites pendant l\'épreuve.'), { duration: 4000 });
        return;
      }
      // Bloquer F12 (DevTools)
      if (e.key === 'F12') {
        e.preventDefault();
        logIncident('devtools_tentative');
        toast.error(t('L\'utilisation des outils de développement est interdite.'), { duration: 4000 });
        return;
      }
      // Bloquer Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (DevTools)
      if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
        e.preventDefault();
        logIncident('devtools_tentative');
        return;
      }
      // Bloquer Ctrl+U (voir source)
      if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        logIncident('voir_source_tentative');
        return;
      }
    };

    // Bloquer le clic droit
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      logIncident('clic_droit_tentative');
    };

    // Bloquer la copie du contenu
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      logIncident('copie_tentative');
      toast.warning(t('La copie est désactivée pendant l\'épreuve.'), { duration: 3000 });
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopy);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopy);
    };
  }, [submission]);

  // Affiche l'avertissement plein écran dès que la session est prête
  useEffect(() => {
    if (submission && !loading) {
      setShowFullscreenWarning(true);
    }
  }, [submission, loading]);

  const enterFullscreen = () => {
    if (isMobile) {
      // Sur mobile le plein écran n'est pas supporté — on ferme simplement le dialog
      setShowFullscreenWarning(false);
      return;
    }
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (el.requestFullscreen) {
      el.requestFullscreen().then(() => { fullscreenActiveRef.current = true; }).catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
      fullscreenActiveRef.current = true;
    }
    setShowFullscreenWarning(false);
  };

  if (loading) {
    return (
      <AppLayout title={t('Épreuve')}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  if (!exam) {
    return (
      <AppLayout title={t('Épreuve')}>
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t('Épreuve non trouvée')}</p>
        </div>
      </AppLayout>
    );
  }

  const answeredCount = Object.keys(answers).filter(k => answers[k]).length;
  const totalQuestions = questions.length;
  const isFullscreen = !!(
    document.fullscreenElement ||
    (document as unknown as Record<string, unknown>).webkitFullscreenElement
  );

  return (
    <AppLayout title={exam.title}>
      <div className="space-y-4 animate-fade-in pb-20 md:pb-0">
        {/* Bannière hors-ligne */}
        {!isOnline && (
          <div className="sticky top-0 z-20 bg-destructive text-destructive-foreground text-center text-sm font-medium py-2 px-4">
            ⚠️ {t('Connexion perdue — vos réponses sont sauvegardées localement. Ne fermez pas cet onglet.')}
          </div>
        )}

        {/* Bannière incidents réseau — dissuasion */}
        {isOnline && networkIncidentCount > 0 && (
          <div className="sticky top-0 z-20 bg-orange-500 text-white text-center text-sm font-medium py-2 px-4">
            ⚠️ {networkIncidentCount} {t('changement')}{networkIncidentCount > 1 ? 's' : ''} {t('de réseau détecté')}{networkIncidentCount > 1 ? 's' : ''} — {t('enregistré')}{networkIncidentCount > 1 ? 's' : ''} {t('et transmis à votre enseignant.')} 
          </div>
        )}

        {/* Timer and Progress */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 md:py-3 px-1 md:px-0 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Clock className={`w-4 h-4 md:w-5 md:h-5 flex-shrink-0 ${timeLeft < 300 ? 'text-destructive animate-pulse' : 'text-primary'}`} />
              <span className={`font-mono text-base md:text-lg font-bold ${timeLeft < 300 ? 'text-destructive' : ''}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
            <div className="text-xs md:text-sm text-muted-foreground text-center">
              <span className="hidden sm:inline">{answeredCount}/{totalQuestions} {t('questions répondues')}</span>
              <span className="sm:hidden">{answeredCount}/{totalQuestions}</span>
              {lastSaved && (
                <span className="block text-xs text-green-600 dark:text-green-400">
                  ✓ {t('Sauvegardé')} {lastSaved.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <Button 
              onClick={() => setShowConfirmDialog(true)}
              disabled={submitting || !isOnline}
              size="sm"
              className="gradient-primary flex-shrink-0"
              title={!isOnline ? t('Connexion requise pour soumettre') : undefined}
            >
              <Send className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">{isOnline ? t('Soumettre') : t('Hors-ligne…')}</span>
            </Button>
            {!isFullscreen && (
              <button
                onClick={enterFullscreen}
                title={t('Passer en plein écran')}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
              >
                <Maximize className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Grille de navigation par questions (colorée) */}
          {totalQuestions > 0 && (
            <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/50">
              {questions.map((eq, index) => {
                const answered = !!(answers[eq.question_id]?.trim());
                return (
                  <button
                    key={eq.id}
                    onClick={() => scrollToQuestion(index)}
                    title={`${t('Question')} ${index + 1}${answered ? ' — ' + t('répondue') : ' — ' + t('sans réponse')}`}
                    className={`w-7 h-7 text-xs rounded font-semibold transition-colors ${
                      answered
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-secondary hover:bg-secondary/80 text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Questions */}
        <div className="space-y-6">
          {(() => {
            let previousPartId = '';
            return questions.map((eq, index) => {
              const currentPartId = eq.part?.id || '';
              const isNewPart = currentPartId && currentPartId !== previousPartId;
              if (currentPartId) {
                previousPartId = currentPartId;
              }

              return (
                <div key={eq.id} className="space-y-3">
                  {isNewPart && (
                    <Card className="bg-primary/5 border-primary/30">
                      <CardContent className="p-4">
                        <p className="text-sm font-semibold text-primary">
                          {eq.part?.title}
                        </p>
                        {eq.part?.subtitle && (
                          <p className="text-sm text-foreground mt-1">{eq.part.subtitle}</p>
                        )}
                        {eq.part?.description && (
                          <p className="text-xs text-muted-foreground mt-1">{eq.part.description}</p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  <div ref={el => { questionRefs.current[index] = el; }}>                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle className="text-sm md:text-base flex items-start gap-2">
                        <span className="text-primary font-mono shrink-0">Q{index + 1}.</span>
                        <span>{eq.question.question_text}</span>
                      </CardTitle>
                      <p className="text-xs md:text-sm text-muted-foreground">
                        {eq.points || eq.question.points} point{((eq.points || eq.question.points) || 0) > 1 ? 's' : ''}
                      </p>
                    </CardHeader>
                    <CardContent>
                      {eq.question.question_type === 'qcm' && eq.question.options && (
                        <RadioGroup
                          value={answers[eq.question_id] || ''}
                          onValueChange={(value) => handleAnswerChange(eq.question_id, value)}
                        >
                          {Array.isArray(eq.question.options) && (eq.question.options as string[]).map((option) => (
                            <div key={`${eq.id}-${option}`} className="flex items-center space-x-3 py-3 md:py-2 min-h-[44px]">
                              <RadioGroupItem value={option} id={`${eq.id}-${option}`} className="w-5 h-5 md:w-4 md:h-4 shrink-0" />
                              <Label htmlFor={`${eq.id}-${option}`} className="cursor-pointer text-sm md:text-base flex-1">
                                {option}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      )}

                      {eq.question.question_type === 'vrai_faux' && (
                        <RadioGroup
                          value={answers[eq.question_id] || ''}
                          onValueChange={(value) => handleAnswerChange(eq.question_id, value)}
                        >
                          <div className="flex items-center space-x-3 py-3 md:py-2 min-h-[44px]">
                            <RadioGroupItem value="Vrai" id={`${eq.id}-vrai`} className="w-5 h-5 md:w-4 md:h-4" />
                            <Label htmlFor={`${eq.id}-vrai`} className="cursor-pointer text-sm md:text-base">{t('Vrai')}</Label>
                          </div>
                          <div className="flex items-center space-x-3 py-3 md:py-2 min-h-[44px]">
                            <RadioGroupItem value="Faux" id={`${eq.id}-faux`} className="w-5 h-5 md:w-4 md:h-4" />
                            <Label htmlFor={`${eq.id}-faux`} className="cursor-pointer text-sm md:text-base">{t('Faux')}</Label>
                          </div>
                        </RadioGroup>
                      )}

                      {(eq.question.question_type === 'reponse_courte' || eq.question.question_type === 'redaction') && (
                        <Textarea
                          placeholder={t('Votre réponse...')}
                          value={answers[eq.question_id] || ''}
                          onChange={(e) => handleAnswerChange(eq.question_id, e.target.value)}
                          rows={eq.question.question_type === 'redaction' ? 6 : 3}
                          className={`bg-input text-sm md:text-base ${eq.question.question_type === 'redaction' ? 'min-h-[140px]' : 'min-h-[80px]'}`}
                        />
                      )}
                    </CardContent>
                  </Card>
                  </div>{/* fin ref question */}
                </div>
              );
            });
          })()}
        </div>

        {/* Bouton Soumettre en bas pour éviter de remonter */}
        <div className="pt-4 pb-24 md:pb-8">
          <Button
            onClick={() => setShowConfirmDialog(true)}
            disabled={submitting}
            className="w-full gradient-primary py-6 text-base"
          >
            <Send className="w-5 h-5 mr-2" />
            {t("Soumettre l'épreuve")} ({answeredCount}/{totalQuestions} {t('réponses')})
          </Button>
        </div>
      </div>

      {/* Dialog temps écoulé avec compte à rebours */}
      <AlertDialog open={showTimeExpiredDialog} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Clock className="w-5 h-5" />
              {t('Temps écoulé !')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block text-base">
                {t("Le temps imparti est écoulé. Votre épreuve va être soumise automatiquement avec les réponses déjà saisies.")}
              </span>
              <span className="block text-center">
                <span className="text-4xl font-mono font-bold text-destructive">{timeExpiredCountdown}</span>
                <span className="text-sm text-muted-foreground block mt-1">{t('secondes avant soumission automatique')}</span>
              </span>
              <span className="block text-sm text-muted-foreground">
                {t('Questions répondues')} : <strong>{answeredCount}/{totalQuestions}</strong>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={handleExpiredSubmit}
              className="bg-destructive hover:bg-destructive/90 w-full"
              disabled={submitting}
            >
              <Send className="w-4 h-4 mr-2" />
              {submitting ? t('Soumission...') : t('Soumettre maintenant')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Avertissement plein écran / démarrage examen */}
      <AlertDialog open={showFullscreenWarning} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Maximize className="w-5 h-5 text-primary" />
              {isMobile ? t("Consignes de l'examen") : t('Mode plein écran requis')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {isMobile ? (
                <>
                  <span className="block">{t("Vous êtes sur un appareil mobile. Le plein écran n'est pas disponible sur ce type d'appareil.")}</span>
                  <span className="block text-destructive font-medium">{t("Ne quittez pas l'application pendant l'épreuve. Tout changement d'application sera enregistré et signalé à votre enseignant.")}</span>
                </>
              ) : (
                <>
                  <span className="block">{t("Pour garantir l'intégrité de l'épreuve, la composition se déroule en")} <strong>{t('plein écran obligatoire')}</strong>.</span>
                  <span className="block text-destructive font-medium">{t("Si vous quittez le plein écran ou changez d'onglet, votre épreuve sera soumise automatiquement avec les réponses déjà saisies.")}</span>
                  <span className="block mt-1 text-xs text-muted-foreground flex items-center gap-1">
                    <Shield className="w-3 h-3 inline" />
                    {t('Protections actives : captures d\'écran, copie, clic droit et outils de développement sont bloqués.')}
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={enterFullscreen}>
              {isMobile ? t("J'ai compris, commencer") : t('Commencer en plein écran')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Submit Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              {t('Confirmer la soumission')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('Vous avez répondu à')} {answeredCount} {t('questions sur')} {totalQuestions}.
              {answeredCount < totalQuestions && (
                <span className="text-warning"> {t("Attention: vous n'avez pas répondu à toutes les questions.")}</span>
              )}
              <br />
              {t('Une fois soumise, vous ne pourrez plus modifier vos réponses.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('Soumission...') : t('Confirmer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default TakeExam;
