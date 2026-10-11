import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff } from 'lucide-react';
import { loginRequestSchema, type AuthResponse } from '@tavolina/shared';
import { Button, Field, Input } from '@tavolina/ui';
import { LanguageSelect } from '../components/LanguageSelect';
import { Logo } from '../components/Logo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { enterSession, publicPost } from '../lib/api';
import { deviceInfo } from '../lib/device';
import { useErrorMessages } from '../lib/errors';
import { useSession } from '../lib/session';
import { homePath } from '../nav';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation();
  const navigate = useNavigate();
  const { message, validate } = useErrorMessages();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const body = { email, password, device: deviceInfo() };
    const result = validate(loginRequestSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setSubmitting(true);
    try {
      const auth = await publicPost<AuthResponse>('/auth/login', body);
      await enterSession(auth);
      navigate(homePath(useSession.getState().can), { replace: true });
    } catch (err) {
      setFormError(message(err));
    } finally {
      setSubmitting(false);
    }
  }

  const points = ['point1', 'point2', 'point3'] as const;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-olive-900 p-12 text-sand-50 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-olive-700/50 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-saffron-500/20 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <Logo className="size-10" />
          <span className="text-xl font-extrabold tracking-tight">{tc('appName')}</span>
        </div>
        <div className="relative flex max-w-md flex-col gap-8">
          <h2 className="text-4xl font-extrabold leading-tight tracking-tight">
            {t('login.side.title')}
          </h2>
          <ul className="flex flex-col gap-4">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-base text-sand-200">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-saffron-400 text-sand-950">
                  <Check className="size-4" aria-hidden />
                </span>
                {t(`login.side.${p}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-sand-400">{tc('tagline')}</p>
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 lg:invisible">
            <Logo className="size-8" />
            <span className="text-lg font-extrabold tracking-tight">{tc('appName')}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSelect />
            <ThemeSwitch />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight">{t('login.title')}</h1>
            <p className="text-foreground-muted">{t('login.subtitle')}</p>
          </div>

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            {formError ? (
              <div
                role="alert"
                className="rounded-control border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger-soft-fg"
              >
                {formError}
              </div>
            ) : null}
            <Field label={t('login.email')} error={errors.email}>
              <Input
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder={t('login.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label={t('login.password')} error={errors.password}>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-control text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <Button type="submit" size="lg" block loading={submitting}>
              {t('login.submit')}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
