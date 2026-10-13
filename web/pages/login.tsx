import { Eye, EyeOff, LockKeyhole, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Field, FieldLabel } from "../components/ui/field";
import { Form } from "../components/ui/form";
import { Input } from "../components/ui/input";
import { LanguageSwitcher } from "../components/language-switcher";
import { useApp } from "../context/app-context";
import { ApiError } from "../lib/api/client";

export function LoginPage() {
  const { t } = useTranslation();
  const { authState, hasApiKey, login, logout, retryVerification } = useApp();
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<LoginErrorKey>();

  if (authState === "authenticated") return <Navigate replace to="/" />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(undefined);
    if (!key.trim()) {
      setErrorKey("login.errors.required");
      return;
    }
    setPending(true);
    try {
      await login(key);
    } catch (cause) {
      setErrorKey(loginErrorKey(cause));
    } finally {
      setPending(false);
    }
  }

  function retrySavedCredential() {
    setPending(true);
    setErrorKey(undefined);
    void retryVerification()
      .catch((cause) => setErrorKey(loginErrorKey(cause)))
      .finally(() => setPending(false));
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <div className="absolute end-4 top-4">
        <LanguageSwitcher />
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl border bg-card shadow-xs">
            <LockKeyhole aria-hidden="true" className="size-5 text-muted-foreground" />
          </div>
          <h1 className="font-semibold text-foreground text-xl tracking-tight">{t("login.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("login.description")}</p>
        </div>

        <Form className="flex w-full flex-col gap-3" onSubmit={submit}>
          {hasApiKey && authState === "verification-error" && (
            <Alert variant="warning">
              <ShieldAlert />
              <AlertTitle>{t("login.verification.pendingTitle")}</AlertTitle>
              <AlertDescription>{t("login.verification.unavailable")}</AlertDescription>
              <AlertAction className="flex flex-wrap gap-2 sm:col-start-2! sm:mt-2! sm:row-auto! sm:self-auto!">
                <Button loading={pending} onClick={retrySavedCredential} size="sm" type="button" variant="outline">
                  {t("login.verification.retry")}
                </Button>
                <Button onClick={() => { logout(); setKey(""); }} size="sm" type="button" variant="ghost">
                  {t("login.verification.clear")}
                </Button>
              </AlertAction>
            </Alert>
          )}

          <Field name="api-key">
            <FieldLabel htmlFor="api-key">{t("login.apiKeyLabel")}</FieldLabel>
            <div className="relative w-full">
              <Input
                autoComplete="current-password"
                autoFocus
                className="pe-10"
                id="api-key"
                name="api-key"
                onChange={(event) => setKey(event.target.value)}
                placeholder={t("login.apiKeyPlaceholder")}
                required
                type={visible ? "text" : "password"}
                value={key}
              />
              <Button
                aria-label={visible ? t("login.hideApiKey") : t("login.showApiKey")}
                className="absolute end-1 top-1/2 -translate-y-1/2"
                onClick={() => setVisible((value) => !value)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </Field>

          {errorKey && (
            <Alert variant="error">
              <ShieldAlert />
              <AlertTitle>{t("login.errorTitle")}</AlertTitle>
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}

          <Button className="w-full" loading={pending} type="submit">
            {t("login.submit")}
          </Button>
        </Form>

        <p className="max-w-xs text-center text-muted-foreground text-xs leading-5">
          {t("login.security.description")}
        </p>
      </div>
    </main>
  );
}

type LoginErrorKey =
  | "login.errors.required"
  | "login.errors.invalid"
  | "login.errors.rootRequired"
  | "login.errors.unavailable";

function loginErrorKey(cause: unknown): LoginErrorKey {
  if (cause instanceof ApiError) {
    if (cause.code === "AUTH_REQUIRED" || cause.code === "AUTH_INVALID") {
      return "login.errors.invalid";
    }
    if (cause.code === "ROOT_REQUIRED") return "login.errors.rootRequired";
  }
  return "login.errors.unavailable";
}
