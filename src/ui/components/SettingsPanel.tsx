import { motion, AnimatePresence } from 'framer-motion';
import { X, Sun, Moon, Globe } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';

export type ThemeMode = 'dark' | 'light';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  isSignedIn: boolean;
  onLogout: () => Promise<void>;
}

function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function SettingsPanel({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  isSignedIn,
  onLogout,
}: SettingsPanelProps) {
  const { t, locale, setLocale } = useLocale();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 glass-panel border-l border-border overflow-y-auto"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
              <h2 className="font-heading text-lg font-bold tracking-wider">
                {t('settings.title').toUpperCase()}
              </h2>
              <motion.button
                onClick={onClose}
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent transition-colors"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            <div className="px-6 py-6 space-y-8">
              <SettingGroup title={t('settings.account')}>
                <div className="py-2 px-3 rounded-md text-sm text-muted-foreground">
                  {isSignedIn ? t('settings.accountSignedIn') : t('settings.accountNotAvailable')}
                </div>
                {isSignedIn && (
                  <button
                    type="button"
                    onClick={() => onLogout()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30 transition-colors"
                  >
                    {t('settings.logout')}
                  </button>
                )}
              </SettingGroup>

              <SettingGroup title={t('settings.languageLabel')}>
                <div className="flex gap-2">
                    {[
                      { loc: 'en' as const, label: t('ui.english') },
                      { loc: 'it' as const, label: t('ui.italian') },
                    ].map(({ loc, label }) => (
                    <motion.button
                      key={loc}
                      onClick={() => setLocale(loc)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider transition-colors border ${
                        locale === loc
                          ? 'bg-primary text-primary-foreground border-primary glow-red'
                          : 'bg-accent/30 text-muted-foreground border-border hover:text-foreground'
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Globe className="w-4 h-4" />
                      {label}
                    </motion.button>
                  ))}
                </div>
              </SettingGroup>

              <SettingGroup title={t('ui.appearance')}>
                <div className="flex gap-2">
                  {[
                    { mode: 'dark' as ThemeMode, icon: Moon, label: t('ui.themeDark') },
                    { mode: 'light' as ThemeMode, icon: Sun, label: t('ui.themeLight') },
                  ].map(({ mode, icon: ModeIcon, label }) => (
                    <motion.button
                      key={mode}
                      onClick={() => onThemeChange(mode)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider transition-colors border ${
                        theme === mode
                          ? 'bg-primary text-primary-foreground border-primary glow-red'
                          : 'bg-accent/30 text-muted-foreground border-border hover:text-foreground'
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <ModeIcon className="w-4 h-4" />
                      {label}
                    </motion.button>
                  ))}
                </div>
              </SettingGroup>

              <div className="pt-4 border-t border-border/50">
                <p className="text-xs text-muted-foreground text-center font-heading tracking-wider">
                  F1 Open Viewer by npanu420
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
