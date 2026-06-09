// Client léger pour interroger l'API backend et stocker la session utilisateur.
// Il encapsule la logique d'appel HTTP et de gestion du token JWT côté frontend.
type Filter = {
  op: 'eq' | 'in' | 'not';
  column: string;
  value?: any;
  operator?: string;
};

type QueryState = {
  table: string;
  operation: 'select' | 'insert' | 'update' | 'delete';
  select: string;
  filters: Filter[];
  order?: { column: string; ascending: boolean };
  limit?: number;
  count?: string;
  head?: boolean;
  single?: boolean;
  maybeSingle?: boolean;
  data?: any;
};

export type User = {
  id: string;
  email: string;
  user_metadata?: { full_name?: string };
};

export type Session = {
  access_token: string;
  token_type: 'bearer';
  user: User;
};

export type SignUpPayload = {
  email: string;
  password: string;
  full_name?: string;
  role?: 'admin' | 'professeur' | 'etudiant';
  student_number?: string;
  level_id?: string;
  specialty_id?: string;
};

export type AdminUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'professeur' | 'etudiant';
  student_profile?: {
    student_number: string;
    level_id: string;
    specialty_id: string;
  } | null;
};

export type AuditLogEntry = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: 'insert' | 'update' | 'delete';
  table_name: string;
  row_id: string | null;
  changes: string | null;
  ip_address: string | null;
  created_at: string | null;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001';
const TOKEN_KEY = 'exam_backend_token';
const USER_KEY = 'exam_backend_user';

type AuthListener = (event: string, session: Session | null) => void;
const authListeners: AuthListener[] = [];

// Lit la session stockée dans sessionStorage et renvoie null si elle est absente ou invalide.
function getStoredSession(): Session | null {
  // sessionStorage : le token n'est pas conservé après fermeture du navigateur/onglet
  // (moins de risque de vol que localStorage en cas de XSS persistant)
  const token = sessionStorage.getItem(TOKEN_KEY);
  const userJson = sessionStorage.getItem(USER_KEY);
  if (!token || !userJson) return null;
  try {
    const user = JSON.parse(userJson);
    return { access_token: token, token_type: 'bearer', user };
  } catch {
    return null;
  }
}

function setStoredSession(session: Session | null) {
  if (!session) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, session.access_token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(session.user));
  }

  authListeners.forEach((cb) => cb(session ? 'SIGNED_IN' : 'SIGNED_OUT', session));
}

// Exécute un appel HTTP vers l'API backend en ajoutant le token d'authentification si présent.
async function apiCall(path: string, method: string, body?: any) {
  const session = getStoredSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      setStoredSession(null);
    }

    return {
      data: null,
      error: { message: payload?.detail || payload?.message || 'Erreur API' },
      count: null,
    };
  }

  return {
    data: payload?.data ?? payload,
    error: payload?.error ?? null,
    count: payload?.count ?? null,
  };
}

class QueryBuilder {
  private state: QueryState;

  constructor(table: string) {
    this.state = {
      table,
      operation: 'select',
      select: '*',
      filters: [],
    };
  }

  select(select = '*', options?: { count?: string; head?: boolean }) {
    this.state.select = select;
    if (options?.count) this.state.count = options.count;
    if (options?.head) this.state.head = options.head;
    return this;
  }

  insert(data: any) {
    this.state.operation = 'insert';
    this.state.data = data;
    return this;
  }

  update(data: any) {
    this.state.operation = 'update';
    this.state.data = data;
    return this;
  }

  delete() {
    this.state.operation = 'delete';
    return this;
  }

  eq(column: string, value: any) {
    this.state.filters.push({ op: 'eq', column, value });
    return this;
  }

  in(column: string, value: any[]) {
    this.state.filters.push({ op: 'in', column, value });
    return this;
  }

  not(column: string, operator: string, value: any) {
    this.state.filters.push({ op: 'not', column, operator, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.state.order = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(value: number) {
    this.state.limit = value;
    return this;
  }

  single() {
    this.state.single = true;
    return this;
  }

  maybeSingle() {
    this.state.maybeSingle = true;
    return this;
  }

  private async execute() {
    if (this.state.operation === 'select') {
      return apiCall('/api/db/query', 'POST', {
        table: this.state.table,
        select: this.state.select,
        filters: this.state.filters,
        order: this.state.order,
        limit: this.state.limit,
        count: this.state.count,
        head: this.state.head,
        single: this.state.single,
        maybe_single: this.state.maybeSingle,
      });
    }

    if (this.state.operation === 'insert') {
      const result = await apiCall('/api/db/insert', 'POST', {
        table: this.state.table,
        data: this.state.data,
      });

      if (this.state.single) {
        return {
          ...result,
          data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        };
      }
      return result;
    }

    if (this.state.operation === 'update') {
      const result = await apiCall('/api/db/update', 'POST', {
        table: this.state.table,
        data: this.state.data,
        filters: this.state.filters,
      });
      return {
        ...result,
        data: this.state.single && Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      };
    }

    return apiCall('/api/db/delete', 'POST', {
      table: this.state.table,
      filters: this.state.filters,
    });
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected as any);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<any | TResult> {
    return this.execute().catch(onrejected as any);
  }

  finally(onfinally?: (() => void) | null): Promise<any> {
    return this.execute().finally(onfinally as any);
  }
}

export const supabase = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  auth: {
    onAuthStateChange(callback: AuthListener) {
      authListeners.push(callback);
      return {
        data: {
          subscription: {
            unsubscribe() {
              const idx = authListeners.indexOf(callback);
              if (idx >= 0) authListeners.splice(idx, 1);
            },
          },
        },
      };
    },
    async getSession() {
      return { data: { session: getStoredSession() } };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const result = await apiCall('/api/auth/login', 'POST', { email, password });
      if (result.error || !result.data?.access_token) {
        return { error: { message: result.error?.message || 'Invalid login' } };
      }

      const session: Session = {
        access_token: result.data.access_token,
        token_type: 'bearer',
        user: {
          id: result.data.user.id,
          email: result.data.user.email,
          user_metadata: { full_name: result.data.user.full_name || '' },
        },
      };
      setStoredSession(session);
      return { error: null };
    },
    async signUp({ email, password, options }: { email: string; password: string; options?: any }) {
      const fullName = options?.data?.full_name || '';
      const role = options?.data?.role || 'etudiant';
      const result = await apiCall('/api/auth/signup', 'POST', {
        email,
        password,
        full_name: fullName,
        role,
        student_number: options?.data?.student_number,
        level_id: options?.data?.level_id,
        specialty_id: options?.data?.specialty_id,
      });

      if (result.error || !result.data?.access_token) {
        return { error: { message: result.error?.message || 'Sign up failed' } };
      }

      const session: Session = {
        access_token: result.data.access_token,
        token_type: 'bearer',
        user: {
          id: result.data.user.id,
          email: result.data.user.email,
          user_metadata: { full_name: result.data.user.full_name || '' },
        },
      };
      setStoredSession(session);
      return { error: null };
    },
    async signOut() {
      setStoredSession(null);
    },

    async getSignUpOptions() {
      const result = await apiCall('/api/auth/signup-options', 'GET');
      if (result.error) {
        return { data: null, error: { message: result.error.message } };
      }
      return { data: result.data, error: null };
    },

    async adminListUsers() {
      const result = await apiCall('/api/auth/admin/users', 'GET');
      if (result.error) {
        return { data: null, error: { message: result.error.message } };
      }
      return { data: result.data as { users: AdminUser[] }, error: null };
    },

    async adminCreateUser(payload: SignUpPayload) {
      const result = await apiCall('/api/auth/admin/users', 'POST', payload);
      if (result.error) {
        return { data: null, error: { message: result.error.message } };
      }
      return { data: result.data, error: null };
    },

    async adminUpdateRole(userId: string, payload: { role: 'admin' | 'professeur' | 'etudiant'; student_number?: string; level_id?: string; specialty_id?: string }) {
      const result = await apiCall(`/api/auth/admin/users/${userId}/role`, 'PATCH', payload);
      if (result.error) {
        return { data: null, error: { message: result.error.message } };
      }
      return { data: result.data, error: null };
    },

    async adminResetPassword(userId: string, newPassword: string) {
      const result = await apiCall('/api/auth/admin/reset-password', 'POST', { user_id: userId, new_password: newPassword });
      if (result.error) {
        return { data: null, error: { message: result.error.message } };
      }
      return { data: result.data, error: null };
    },

    async adminDisableUser(userId: string, disabled: boolean) {
      const result = await apiCall('/api/auth/admin/disable-user', 'POST', { user_id: userId, disabled });
      if (result.error) {
        return { data: null, error: { message: result.error.message } };
      }
      return { data: result.data, error: null };
    },

    async adminGetAuditLogs(params: { limit?: number; offset?: number; table_name?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.limit !== undefined) qs.set('limit', String(params.limit));
      if (params.offset !== undefined) qs.set('offset', String(params.offset));
      if (params.table_name) qs.set('table_name', params.table_name);
      const result = await apiCall(`/api/auth/audit-logs?${qs.toString()}`, 'GET');
      if (result.error) {
        return { data: null, error: { message: result.error.message } };
      }
      return { data: result.data as { total: number; logs: AuditLogEntry[] }, error: null };
    },
  },
};
