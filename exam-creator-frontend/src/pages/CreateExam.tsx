import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, GripVertical, FileCheck, Pencil, Upload, Sparkles, Loader2, Bot, Zap, CalendarClock } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/backendClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Subject {
  id: string;
  name: string;
}

interface Specialty {
  id: string;
  name: string;
  allowed_subject_ids?: string[] | null;
}

interface Level {
  id: string;
  name: string;
}

type QuestionType = 'qcm' | 'vrai_faux' | 'reponse_courte' | 'redaction';

interface ExamPartDraft {
  local_id: string;
  id?: string;       // set when loaded from DB
  title: string;
  subtitle: string;
  description: string;
  order_index: number;
}

interface QuestionDraft {
  id?: string;
  question_text: string;
  question_type: QuestionType;
  options: string[];
  correct_answer: string;
  points: number;
  part_local_id: string;
  ai_suggested?: boolean;
}

interface ImportedQuestion {
  question_text: string;
  question_type?: QuestionType;
  options?: string[];
  correct_answer?: string;
  points?: number;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.123:8000/api';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Formate une Date en ISO local (sans conversion UTC) pour les inputs datetime-local et le stockage backend */
const toLocalISO = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const getQuestionTypeLabel = (questionType: QuestionType) => {
  if (questionType === 'qcm') return 'QCM';
  if (questionType === 'vrai_faux') return 'Vrai/Faux';
  if (questionType === 'reponse_courte') return 'Réponse courte';
  return 'Rédaction';
};

const CreateExam = () => {
  const navigate = useNavigate();
  const { id: examId } = useParams<{ id?: string }>();
  const isEditMode = !!examId;
  const { user } = useAuth();
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingExam, setLoadingExam] = useState(isEditMode);
  const [importingPdf, setImportingPdf] = useState(false);
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null);
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [schedulingMode, setSchedulingMode] = useState<'now' | 'scheduled'>('scheduled');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    subject_id: '',
    specialty_id: '',
    level_id: '',
    evaluation_type: '',
    semester: '',
    duration_minutes: 60,
    scheduled_start: '',
    scheduled_end: '',
  });

  const [parts, setParts] = useState<ExamPartDraft[]>([
    {
      local_id: uid(),
      title: 'Partie 1',
      subtitle: '',
      description: '',
      order_index: 0,
    },
  ]);

  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionDraft>({
    question_text: '',
    question_type: 'qcm',
    options: ['', '', '', ''],
    correct_answer: '',
    points: 1,
    part_local_id: '',
  });

  useEffect(() => {
    const fetchData = async () => {
      const [subjectsRes, specialtiesRes, levelsRes] = await Promise.all([
        supabase.from('subjects').select('*'),
        supabase.from('specialties').select('*'),
        supabase.from('levels').select('*'),
      ]);

      if (subjectsRes.data) setSubjects(subjectsRes.data);
      if (specialtiesRes.data) setSpecialties(specialtiesRes.data as Specialty[]);
      if (levelsRes.data) setLevels(levelsRes.data);
    };

    fetchData();
  }, []);

  // Chargement des données en mode édition
  useEffect(() => {
    if (!isEditMode || !examId) return;

    const loadExam = async () => {
      setLoadingExam(true);
      try {
        const { data: exam, error: examError } = await supabase
          .from('exams')
          .select('*')
          .eq('id', examId)
          .single();
        if (examError) throw examError;

        setFormData({
          title: exam.title || '',
          description: exam.description || '',
          subject_id: exam.subject_id || '',
          specialty_id: exam.specialty_id || '',
          level_id: exam.level_id || '',
          evaluation_type: exam.evaluation_type || '',
          semester: exam.semester || '',
          duration_minutes: exam.duration_minutes || 60,
          scheduled_start: exam.start_date ? exam.start_date.slice(0, 16) : '',
          scheduled_end: exam.end_date ? exam.end_date.slice(0, 16) : '',
        });
        if (exam.start_date) setSchedulingMode('scheduled');

        const { data: partsData, error: partsError } = await supabase
          .from('exam_parts')
          .select('*')
          .eq('exam_id', examId)
          .order('order_index');
        if (partsError) throw partsError;

        const loadedParts: ExamPartDraft[] = (partsData || []).map((p) => ({
          local_id: p.id,
          id: p.id,
          title: p.title || '',
          subtitle: p.subtitle || '',
          description: p.description || '',
          order_index: p.order_index || 0,
        }));
        if (loadedParts.length > 0) setParts(loadedParts);

        const { data: eqData, error: eqError } = await supabase
          .from('exam_questions')
          .select(`id, order_index, points, part_id, question_id, question:questions(id, question_text, question_type, options, correct_answer, points)`)
          .eq('exam_id', examId)
          .order('order_index');
        if (eqError) throw eqError;

        const loadedQuestions: QuestionDraft[] = (eqData || []).map((eq) => {
          const q = eq.question as { id: string; question_text: string; question_type: QuestionType; options: string[]; correct_answer: string; points: number };
          return {
            id: q?.id,
            question_text: q?.question_text || '',
            question_type: (q?.question_type as QuestionType) || 'qcm',
            options: Array.isArray(q?.options) ? q.options : [],
            correct_answer: q?.correct_answer || '',
            points: eq.points || q?.points || 1,
            part_local_id: eq.part_id || loadedParts[0]?.local_id || '',
          };
        });
        setQuestions(loadedQuestions);
      } catch (err) {
        console.error(err);
        toast.error('Erreur lors du chargement de l\'épreuve');
        navigate('/exams');
      } finally {
        setLoadingExam(false);
      }
    };

    loadExam();
  }, [examId, isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (parts.length > 0 && !currentQuestion.part_local_id) {
      setCurrentQuestion((prev) => ({ ...prev, part_local_id: parts[0].local_id }));
    }
  }, [parts, currentQuestion.part_local_id]);

  const selectedSpecialty = useMemo(
    () => specialties.find((s) => s.id === formData.specialty_id),
    [specialties, formData.specialty_id],
  );

  const filteredSubjects = useMemo(() => {
    if (!selectedSpecialty) return subjects;
    const allowed = selectedSpecialty.allowed_subject_ids || [];
    if (!Array.isArray(allowed) || allowed.length === 0) return [];
    return subjects.filter((subject) => allowed.includes(subject.id));
  }, [subjects, selectedSpecialty]);

  const resetQuestionForm = (partLocalId?: string) => {
    setCurrentQuestion({
      question_text: '',
      question_type: 'qcm',
      options: ['', '', '', ''],
      correct_answer: '',
      points: 1,
      part_local_id: partLocalId || parts[0]?.local_id || '',
    });
    setEditingQuestionIndex(null);
  };

  const openAddQuestionDialog = () => {
    resetQuestionForm(parts[0]?.local_id || '');
    setShowQuestionDialog(true);
  };

  const openEditQuestionDialog = (index: number) => {
    const q = questions[index];
    setCurrentQuestion({
      ...q,
      options: Array.isArray(q.options) ? q.options : ['', '', '', ''],
    });
    setEditingQuestionIndex(index);
    setShowQuestionDialog(true);
  };

  const saveQuestion = () => {
    if (!currentQuestion.question_text.trim()) {
      toast.error('Veuillez entrer une question');
      return;
    }

    if (!currentQuestion.part_local_id) {
      toast.error('Veuillez choisir une partie pour la question');
      return;
    }

    const normalized: QuestionDraft = {
      ...currentQuestion,
      options: currentQuestion.question_type === 'qcm'
        ? currentQuestion.options.map((o) => o.trim()).filter(Boolean)
        : [],
    };

    if (editingQuestionIndex === null) {
      setQuestions((prev) => [...prev, normalized]);
      toast.success('Question ajoutée');
    } else {
      setQuestions((prev) => prev.map((q, i) => (i === editingQuestionIndex ? normalized : q)));
      toast.success('Question modifiée');
    }

    setShowQuestionDialog(false);
    resetQuestionForm();
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const addPart = () => {
    setParts((prev) => [
      ...prev,
      {
        local_id: uid(),
        title: `Partie ${prev.length + 1}`,
        subtitle: '',
        description: '',
        order_index: prev.length,
      },
    ]);
  };

  const updatePart = (localId: string, patch: Partial<ExamPartDraft>) => {
    setParts((prev) => prev.map((p) => (p.local_id === localId ? { ...p, ...patch } : p)));
  };

  const removePart = (localId: string) => {
    if (parts.length <= 1) {
      toast.error('Au moins une partie est requise');
      return;
    }

    const nextParts = parts.filter((p) => p.local_id !== localId).map((p, i) => ({ ...p, order_index: i }));
    setParts(nextParts);

    const fallbackPart = nextParts[0]?.local_id || '';
    setQuestions((prev) =>
      prev.map((q) => (q.part_local_id === localId ? { ...q, part_local_id: fallbackPart } : q)),
    );
  };

  const normalizeImportedQuestion = (q: ImportedQuestion, defaultPartId: string): QuestionDraft => {
    const qType = q.question_type || (Array.isArray(q.options) && q.options.length > 0 ? 'qcm' : 'reponse_courte');
    const options = qType === 'qcm' ? (q.options || ['', '', '', '']) : [];
    return {
      question_text: q.question_text || '',
      question_type: qType,
      options,
      correct_answer: q.correct_answer || '',
      points: q.points || 1,
      part_local_id: defaultPartId,
    };
  };

  const importPdfQuestions = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Veuillez sélectionner un fichier PDF');
      return;
    }

    setImportingPdf(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes?.data?.session?.access_token;
      if (!token) {
        toast.error('Session expirée, reconnectez-vous');
        navigate('/auth');
        return;
      }

      const body = new FormData();
      body.append('file', file);

      const res = await fetch(`${API_URL}/api/exams/import-pdf`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body,
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.detail || payload?.message || 'Import PDF impossible');
      }

      const extracted: ImportedQuestion[] = payload?.data?.questions || payload?.questions || [];
      if (!Array.isArray(extracted) || extracted.length === 0) {
        toast.error('Aucune question détectée dans le PDF');
        return;
      }

      const targetPartId = parts[0]?.local_id || '';
      const normalized = extracted
        .map((q) => normalizeImportedQuestion(q, targetPartId))
        .filter((q) => q.question_text.trim().length > 0);

      if (normalized.length === 0) {
        toast.error('Aucune question exploitable après extraction');
        return;
      }

      setQuestions((prev) => [...prev, ...normalized]);
      toast.success(`${normalized.length} question(s) importée(s). Utilisez le bouton 🤖 pour suggérer une réponse par IA.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur pendant l\'import PDF';
      toast.error(message);
    } finally {
      setImportingPdf(false);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = '';
      }
    }
  };

  const suggestOneAnswer = async (index: number) => {
    const q = questions[index];
    if (!q) return;
    setSuggestingIndex(index);
    toast.info('IA en cours de réflexion... Cela peut prendre 1-2 minutes.');
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes?.data?.session?.access_token;
      if (!token) { toast.error('Session expirée'); return; }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      const res = await fetch(`${API_URL}/api/exams/suggest-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
        body: JSON.stringify({
          questions: [{
            question_text: q.question_text,
            question_type: q.question_type,
            options: q.options,
            correct_answer: q.correct_answer,
            points: q.points,
          }],
        }),
      });
      clearTimeout(timeoutId);
      const payload = await res.json().catch(() => null);
      const suggested = payload?.data?.questions?.[0];
      if (suggested?.correct_answer) {
        setQuestions((prev) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], correct_answer: suggested.correct_answer, ai_suggested: true };
          return updated;
        });
        toast.success('Réponse IA suggérée. Vérifiez-la.');
      } else {
        toast.info('L\'IA n\'a pas pu suggérer de réponse.');
      }
    } catch {
      toast.error('Délai dépassé ou erreur IA. Entrez la réponse manuellement.');
    } finally {
      setSuggestingIndex(null);
    }
  };

  const handleSubmit = async (status: 'brouillon' | 'publie') => {
    if (!formData.title.trim()) {
      toast.error('Veuillez entrer un titre');
      return;
    }
    if (!formData.subject_id) {
      toast.error('Veuillez sélectionner une matière');
      return;
    }
    if (!formData.specialty_id) {
      toast.error('Veuillez sélectionner une filière');
      return;
    }
    if (!formData.level_id) {
      toast.error('Veuillez sélectionner un niveau');
      return;
    }
    if (!formData.evaluation_type) {
      toast.error('Veuillez sélectionner le type d\'évaluation');
      return;
    }
    if (!formData.semester) {
      toast.error('Veuillez sélectionner le semestre');
      return;
    }
    if (status === 'publie') {
      if (schedulingMode === 'scheduled') {
        if (!formData.scheduled_start || !formData.scheduled_end) {
          toast.error('Veuillez définir la date/heure de début et de fin');
          return;
        }
        if (new Date(formData.scheduled_end) <= new Date(formData.scheduled_start)) {
          toast.error('L\'heure de fin doit être après l\'heure de début');
          return;
        }
      } else {
        if (!formData.duration_minutes || formData.duration_minutes < 5) {
          toast.error('Veuillez entrer une durée valide (minimum 5 min)');
          return;
        }
      }
    }
    if (parts.some((p) => !p.title.trim())) {
      toast.error('Chaque partie doit avoir un titre');
      return;
    }

    // Block publication if some questions have no correct answer
    if (status === 'publie') {
      const missing = questions.filter((q) => !q.correct_answer?.trim());
      if (missing.length > 0) {
        toast.error(
          `${missing.length} question${missing.length > 1 ? 's' : ''} sans réponse correcte. Complétez toutes les réponses avant de publier.`
        );
        return;
      }
      if (questions.length === 0) {
        toast.error("Ajoutez au moins une question avant de publier.");
        return;
      }
    }

    setLoading(true);
    try {
      const totalPoints = questions.reduce((acc, q) => acc + (q.points || 0), 0);

      // Calculer start_date, end_date et duration selon le mode
      let startIso: string | null = null;
      let endIso: string | null = null;
      let duration_minutes = formData.duration_minutes;
      let finalStatus: string = status;

      if (status !== 'brouillon') {
        if (schedulingMode === 'now') {
          const startDt = new Date();
          const endDt = new Date(startDt.getTime() + formData.duration_minutes * 60000);
          startIso = toLocalISO(startDt);
          endIso = toLocalISO(endDt);
          finalStatus = 'publie';
        } else {
          // Mode programmé (scheduled_start vient du datetime-local = heure locale)
          const startDt = new Date(formData.scheduled_start);
          const endDt = new Date(formData.scheduled_end);
          startIso = toLocalISO(startDt);
          endIso = toLocalISO(endDt);
          duration_minutes = Math.round((endDt.getTime() - startDt.getTime()) / 60000);
          // Si la date de début est dans le futur → 'programme', sinon 'publie'
          finalStatus = startDt > new Date() ? 'programme' : 'publie';
        }
      }

      let examId_saved = examId || '';

      if (isEditMode && examId) {
        // -- Mode édition : UPDATE l'épreuve --
        const { error: updateError } = await supabase
          .from('exams')
          .update({
            title: formData.title,
            description: formData.description,
            subject_id: formData.subject_id,
            specialty_id: formData.specialty_id,
            level_id: formData.level_id,
            evaluation_type: formData.evaluation_type,
            semester: formData.semester,
            duration_minutes,
            start_date: startIso,
            end_date: endIso,
            status: finalStatus,
            total_points: totalPoints,
          })
          .eq('id', examId);
        if (updateError) throw updateError;

        // Supprimer les anciennes parties et liens (les questions en base sont conservées)
        await supabase.from('exam_questions').delete().eq('exam_id', examId);
        await supabase.from('exam_parts').delete().eq('exam_id', examId);
      } else {
        // -- Mode création : INSERT --
        const { data: exam, error: examError } = await supabase
          .from('exams')
          .insert({
            title: formData.title,
            description: formData.description,
            subject_id: formData.subject_id,
            specialty_id: formData.specialty_id,
            level_id: formData.level_id,
            evaluation_type: formData.evaluation_type,
            semester: formData.semester,
            duration_minutes,
            start_date: startIso,
            end_date: endIso,
            status: finalStatus,
            created_by: user?.id,
            total_points: totalPoints,
          })
          .select()
          .single();
        if (examError) throw examError;
        examId_saved = exam.id;
      }

      const partIdMap: Record<string, string> = {};
      for (const part of [...parts].sort((a, b) => a.order_index - b.order_index)) {
        const { data: createdPart, error: partError } = await supabase
          .from('exam_parts')
          .insert({
            exam_id: examId_saved,
            title: part.title,
            subtitle: part.subtitle,
            description: part.description,
            order_index: part.order_index,
          })
          .select()
          .single();

        if (partError) throw partError;
        partIdMap[part.local_id] = createdPart.id;
      }

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        let questionId = q.id;

        if (questionId) {
          // Question existante : mettre à jour
          await supabase
            .from('questions')
            .update({
              question_text: q.question_text,
              question_type: q.question_type,
              options: q.options,
              correct_answer: q.correct_answer,
              points: q.points,
            })
            .eq('id', questionId);
        } else {
          // Nouvelle question
          const { data: questionData, error: qError } = await supabase
            .from('questions')
            .insert({
              question_text: q.question_text,
              question_type: q.question_type,
              options: q.options,
              correct_answer: q.correct_answer,
              points: q.points,
              subject_id: formData.subject_id,
              created_by: user?.id,
            })
            .select()
            .single();
          if (qError) throw qError;
          questionId = questionData.id;
        }

        const { error: linkError } = await supabase
          .from('exam_questions')
          .insert({
            exam_id: examId_saved,
            part_id: partIdMap[q.part_local_id] || null,
            question_id: questionId,
            order_index: i,
            points: q.points,
          });

        if (linkError) throw linkError;
      }

      toast.success(
        finalStatus === 'programme'
          ? `Épreuve programmée pour le ${new Date(startIso!).toLocaleString('fr-FR')}`
          : finalStatus === 'publie'
          ? 'Épreuve publiée'
          : isEditMode ? 'Modifications enregistrées' : 'Brouillon enregistré'
      );
      navigate('/exams');
    } catch (error) {
      console.error(error);
      toast.error(isEditMode ? 'Erreur lors de la modification' : 'Erreur lors de la création de l\'épreuve');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout title={isEditMode ? "Modifier l'Épreuve" : "Création d'Épreuve"}>
      {loadingExam ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
      <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          <Button
            onClick={() => setShowPreviewDialog(true)}
            disabled={loading}
            size="sm"
            className="gradient-primary shadow-md"
          >
            <FileCheck className="w-4 h-4 mr-1.5" />
            Aperçu final
          </Button>
        </div>

        {/* Section 1: Informations générales */}
        <Card className="shadow-card border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold text-foreground">Informations générales</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Détails principaux de l'épreuve</p>
          </div>
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Titre de l'épreuve</Label>
              <Input
                id="title"
                placeholder="Ex: Réseaux et Sécurité Informatique"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Ajoutez une brève description de l'épreuve"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Filière</Label>
                <Select
                  value={formData.specialty_id}
                  onValueChange={(value) => setFormData({ ...formData, specialty_id: value, subject_id: '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionnez" />
                  </SelectTrigger>
                  <SelectContent>
                    {specialties.map((specialty) => (
                      <SelectItem key={specialty.id} value={specialty.id}>
                        {specialty.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Matière</Label>
                <Select
                  value={formData.subject_id}
                  onValueChange={(value) => setFormData({ ...formData, subject_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionnez" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSubjects.map((subject) => (
                      <SelectItem key={subject.id} value={subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Niveau</Label>
                <Select
                  value={formData.level_id}
                  onValueChange={(value) => setFormData({ ...formData, level_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionnez" />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((level) => (
                      <SelectItem key={level.id} value={level.id}>
                        {level.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Type d'évaluation</Label>
                <Input
                  placeholder="Ex: Session normale 1"
                  value={formData.evaluation_type}
                  onChange={(e) => setFormData({ ...formData, evaluation_type: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Semestre</Label>
                <Input
                  placeholder="Ex: S1"
                  value={formData.semester}
                  onChange={(e) => setFormData({ ...formData, semester: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Planification */}
        <Card className="shadow-card border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold text-foreground">Planification</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Choisissez quand l'épreuve sera disponible</p>
          </div>
          <CardContent className="p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSchedulingMode('now')}
                className={`relative flex flex-col items-center gap-2 py-5 px-4 rounded-xl border-2 text-sm font-medium transition-all duration-200 ${
                  schedulingMode === 'now'
                    ? 'border-primary bg-primary/8 text-primary shadow-sm'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/50'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  schedulingMode === 'now' ? 'bg-primary/15' : 'bg-muted'
                }`}>
                  <Zap className="w-5 h-5" />
                </div>
                Publier immédiatement
                <p className="text-xs font-normal opacity-60">Le chronomètre démarre maintenant</p>
              </button>
              <button
                type="button"
                onClick={() => setSchedulingMode('scheduled')}
                className={`relative flex flex-col items-center gap-2 py-5 px-4 rounded-xl border-2 text-sm font-medium transition-all duration-200 ${
                  schedulingMode === 'scheduled'
                    ? 'border-primary bg-primary/8 text-primary shadow-sm'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/50'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  schedulingMode === 'scheduled' ? 'bg-primary/15' : 'bg-muted'
                }`}>
                  <CalendarClock className="w-5 h-5" />
                </div>
                Programmer
                <p className="text-xs font-normal opacity-60">Définir la plage horaire exacte</p>
              </button>
            </div>

            {schedulingMode === 'now' ? (
              <div className="space-y-2">
                <Label htmlFor="duration_now">Durée de la composition (minutes)</Label>
                <Input
                  id="duration_now"
                  type="number"
                  min={5}
                  max={360}
                  value={formData.duration_minutes}
                  onChange={(e) => setFormData({ ...formData, duration_minutes: Number.parseInt(e.target.value, 10) || 60 })}
                />
                <p className="text-xs text-muted-foreground">
                  L'épreuve sera ouverte de maintenant jusqu'à maintenant + {formData.duration_minutes} min
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scheduled_start">Date et heure de début</Label>
                  <Input
                    id="scheduled_start"
                    type="datetime-local"
                    value={formData.scheduled_start}
                    onChange={(e) => setFormData({ ...formData, scheduled_start: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scheduled_end">Date et heure de fin</Label>
                  <Input
                    id="scheduled_end"
                    type="datetime-local"
                    value={formData.scheduled_end}
                    onChange={(e) => setFormData({ ...formData, scheduled_end: e.target.value })}
                  />
                </div>
                {formData.scheduled_start && formData.scheduled_end && new Date(formData.scheduled_end) > new Date(formData.scheduled_start) && (
                  <div className="md:col-span-2">
                    <p className="text-xs text-muted-foreground">
                      Durée : {Math.round((new Date(formData.scheduled_end).getTime() - new Date(formData.scheduled_start).getTime()) / 60000)} min
                      {new Date(formData.scheduled_start) > new Date() && (
                        <span className="ml-2 text-amber-500 dark:text-amber-400 inline-flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Programmée — publiée automatiquement à l'heure de début</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 3: Parties */}
        <Card className="shadow-card border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Parties de l'épreuve</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{parts.length} partie{parts.length > 1 ? 's' : ''} configurée{parts.length > 1 ? 's' : ''}</p>
            </div>
            <Button variant="outline" size="sm" onClick={addPart}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Ajouter
            </Button>
          </div>
          <CardContent className="p-6 space-y-4">
            {parts
              .slice()
              .sort((a, b) => a.order_index - b.order_index)
              .map((part, index) => (
                <div key={part.local_id} className="rounded-xl border border-border bg-muted/20 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">{index + 1}</span>
                      </div>
                      <p className="text-sm font-semibold text-foreground">Partie {index + 1}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removePart(part.local_id)}
                      className="w-8 h-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Titre</Label>
                      <Input
                        value={part.title}
                        onChange={(e) => updatePart(part.local_id, { title: e.target.value })}
                        placeholder="Ex: Administration systèmes"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sous-titre</Label>
                      <Input
                        value={part.subtitle}
                        onChange={(e) => updatePart(part.local_id, { subtitle: e.target.value })}
                        placeholder="Ex: Linux, services et sécurité"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description / Consignes</Label>
                    <Textarea
                      rows={2}
                      value={part.description}
                      onChange={(e) => updatePart(part.local_id, { description: e.target.value })}
                      placeholder="Consignes spécifiques à cette partie"
                    />
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>

        {/* Section 4: Questions */}
        <Card className="shadow-card border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Questions</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{questions.length} question{questions.length > 1 ? 's' : ''} · {questions.reduce((a, q) => a + q.points, 0)} points au total</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    importPdfQuestions(file);
                  }
                }}
              />
              <Button
                variant="outline"
                onClick={() => pdfInputRef.current?.click()}
                disabled={importingPdf}
              >
                <Upload className="w-4 h-4 mr-2" />
                {importingPdf ? 'Import en cours...' : 'Importer un PDF'}
              </Button>

              <Dialog open={showQuestionDialog} onOpenChange={setShowQuestionDialog}>
                <DialogTrigger asChild>
                  <Button className="gradient-success text-success-foreground" onClick={openAddQuestionDialog}>
                    <Plus className="w-4 h-4 mr-2" />
                    Ajouter une question
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingQuestionIndex === null ? 'Nouvelle question' : 'Modifier la question'}</DialogTitle>
                  </DialogHeader>

                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Partie</Label>
                      <Select
                        value={currentQuestion.part_local_id}
                        onValueChange={(value) => setCurrentQuestion({ ...currentQuestion, part_local_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choisir la partie" />
                        </SelectTrigger>
                        <SelectContent>
                          {parts
                            .slice()
                            .sort((a, b) => a.order_index - b.order_index)
                            .map((p, idx) => (
                              <SelectItem key={p.local_id} value={p.local_id}>
                                Partie {idx + 1}: {p.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Type de question</Label>
                      <Select
                        value={currentQuestion.question_type}
                        onValueChange={(value: QuestionType) =>
                          setCurrentQuestion({ ...currentQuestion, question_type: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="qcm">QCM</SelectItem>
                          <SelectItem value="vrai_faux">Vrai/Faux</SelectItem>
                          <SelectItem value="reponse_courte">Réponse courte</SelectItem>
                          <SelectItem value="redaction">Rédaction</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Question</Label>
                      <Textarea
                        placeholder="Entrez votre question"
                        value={currentQuestion.question_text}
                        onChange={(e) => setCurrentQuestion({ ...currentQuestion, question_text: e.target.value })}
                      />
                    </div>

                    {currentQuestion.question_type === 'qcm' && (
                      <div className="space-y-2">
                        <Label>Options</Label>
                        {currentQuestion.options.map((opt, idx) => (
                          <Input
                            key={`${idx}-${opt.length}`}
                            placeholder={`Option ${idx + 1}`}
                            value={opt}
                            onChange={(e) => {
                              const nextOptions = [...currentQuestion.options];
                              nextOptions[idx] = e.target.value;
                              setCurrentQuestion({ ...currentQuestion, options: nextOptions });
                            }}
                          />
                        ))}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Réponse correcte</Label>
                      {currentQuestion.question_type === 'vrai_faux' ? (
                        <Select
                          value={currentQuestion.correct_answer}
                          onValueChange={(value) => setCurrentQuestion({ ...currentQuestion, correct_answer: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionnez" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Vrai">Vrai</SelectItem>
                            <SelectItem value="Faux">Faux</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          placeholder="Réponse correcte"
                          value={currentQuestion.correct_answer}
                          onChange={(e) => setCurrentQuestion({ ...currentQuestion, correct_answer: e.target.value })}
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Points</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={currentQuestion.points}
                        onChange={(e) => setCurrentQuestion({ ...currentQuestion, points: Number.parseInt(e.target.value, 10) || 1 })}
                      />
                    </div>

                    <Button onClick={saveQuestion} className="w-full gradient-primary">
                      {editingQuestionIndex === null ? 'Ajouter' : 'Enregistrer les modifications'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <CardContent className="p-6">
            <div>
              {questions.length === 0 ? (
                <div className="py-8 flex flex-col items-center justify-center text-center">
                  <FileCheck className="w-12 h-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground mb-2">Aucune question pour le moment.</p>
                  <p className="text-xs text-muted-foreground">Ajoutez manuellement ou importez un PDF puis modifiez si nécessaire.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {questions.map((q, index) => {
                    const part = parts.find((p) => p.local_id === q.part_local_id);
                    const partNumber = Math.max(parts.findIndex((p) => p.local_id === q.part_local_id), 0) + 1;
                    return (
                      <Card key={`${index}-${q.question_text.slice(0, 12)}`} className="bg-secondary border-0">
                        <CardContent className="p-4 flex items-start gap-3">
                          <GripVertical className="w-5 h-5 text-muted-foreground mt-1" />
                          <div className="flex-1 text-left space-y-1">
                            <p className="text-xs text-primary font-medium">
                              Partie {partNumber}: {part?.title || 'Sans partie'}
                            </p>
                            <p className="font-medium text-foreground">{q.question_text}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-muted-foreground">
                                {getQuestionTypeLabel(q.question_type)}
                                {' · '}
                                {q.points} point{q.points > 1 ? 's' : ''}
                              </p>
                              {q.ai_suggested && (
                                <span className="inline-flex items-center gap-1 text-xs bg-blue-500/15 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                                  <Sparkles className="w-3 h-3" />
                                  Réponse IA
                                </span>
                              )}
                              {q.correct_answer ? (
                                <span className="text-xs text-green-600 dark:text-green-400">✓ Réponse définie</span>
                              ) : (
                                <span className="text-xs text-amber-600 dark:text-amber-400">Réponse manquante</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {!q.correct_answer && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Suggérer une réponse par IA"
                                disabled={suggestingIndex !== null}
                                onClick={() => suggestOneAnswer(index)}
                              >
                                {suggestingIndex === index ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Bot className="w-4 h-4 text-blue-500" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditQuestionDialog(index)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeQuestion(index)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-3 pb-20 md:pb-0">
          <Button
            variant="outline"
            className="flex-1 h-11"
            onClick={() => handleSubmit('brouillon')}
            disabled={loading}
          >
            Enregistrer brouillon
          </Button>
          <Button
            className="flex-1 h-11 gradient-primary shadow-md"
            onClick={() => setShowPreviewDialog(true)}
            disabled={loading}
          >
            <FileCheck className="w-4 h-4 mr-1.5" />
            Aperçu avant publication
          </Button>
        </div>

        <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Aperçu final par parties</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <Card className="bg-secondary border-0">
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <p className="text-sm"><span className="font-semibold">Épreuve:</span> {formData.title || '-'}</p>
                  <p className="text-sm"><span className="font-semibold">Début:</span> {formData.scheduled_start ? new Date(formData.scheduled_start).toLocaleString('fr-FR') : '-'}</p>
                  <p className="text-sm"><span className="font-semibold">Fin:</span> {formData.scheduled_end ? new Date(formData.scheduled_end).toLocaleString('fr-FR') : '-'}</p>
                  <p className="text-sm"><span className="font-semibold">Durée:</span> {formData.scheduled_start && formData.scheduled_end ? `${Math.round((new Date(formData.scheduled_end).getTime() - new Date(formData.scheduled_start).getTime()) / 60000)} min` : '-'}</p>
                  <p className="text-sm"><span className="font-semibold">Type:</span> {formData.evaluation_type || '-'}</p>
                  <p className="text-sm"><span className="font-semibold">Semestre:</span> {formData.semester || '-'}</p>
                  <p className="text-sm"><span className="font-semibold">Nombre de parties:</span> {parts.length}</p>
                  <p className="text-sm"><span className="font-semibold">Total questions:</span> {questions.length}</p>
                  <p className="text-sm"><span className="font-semibold">Total points:</span> {questions.reduce((acc, q) => acc + q.points, 0)}</p>
                </CardContent>
              </Card>

              {parts
                .slice()
                .sort((a, b) => a.order_index - b.order_index)
                .map((part, index) => {
                  const partQuestions = questions.filter((q) => q.part_local_id === part.local_id);
                  const partPoints = partQuestions.reduce((acc, q) => acc + q.points, 0);
                  return (
                    <Card key={`preview-${part.local_id}`} className="bg-card border-border">
                      <CardContent className="p-4 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-primary">Partie {index + 1}: {part.title || 'Sans titre'}</p>
                          {part.subtitle && <p className="text-sm text-foreground">{part.subtitle}</p>}
                          {part.description && <p className="text-xs text-muted-foreground mt-1">{part.description}</p>}
                          <p className="text-xs text-muted-foreground mt-1">
                            {partQuestions.length} question(s) • {partPoints} point(s)
                          </p>
                        </div>

                        {partQuestions.length === 0 ? (
                          <p className="text-sm text-destructive">Aucune question dans cette partie.</p>
                        ) : (
                          <div className="space-y-2">
                            {partQuestions.map((q, qIndex) => (
                              <div key={`preview-q-${part.local_id}-${qIndex}`} className="p-3 rounded-md bg-secondary/70">
                                <p className="text-sm font-medium">Q{qIndex + 1}. {q.question_text}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {getQuestionTypeLabel(q.question_type)} • {q.points} point(s)
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowPreviewDialog(false)}>
                  Revenir à l'édition
                </Button>
                <Button
                  className="flex-1 gradient-primary"
                  disabled={loading}
                  onClick={() => handleSubmit('publie')}
                >
                  {loading ? 'Publication...' : 'Confirmer et publier'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )}
  </AppLayout>
  );
};

export default CreateExam;
