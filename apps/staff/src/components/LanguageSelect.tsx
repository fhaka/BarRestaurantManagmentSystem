import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { LANGS, isLang } from '@tavolina/shared';
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@tavolina/ui';
import { changeLanguage } from '../i18n';

export function LanguageSelect() {
  const { t, i18n } = useTranslation();
  return (
    <SelectRoot
      value={i18n.language}
      onValueChange={(value) => {
        if (isLang(value)) void changeLanguage(value);
      }}
    >
      <SelectTrigger className="h-10 w-auto gap-1.5 pl-2.5" aria-label={t('language.label')}>
        <span className="flex items-center gap-2">
          <Languages className="size-4 text-foreground-muted" aria-hidden />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end">
        {LANGS.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {t(`language.${lang}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
