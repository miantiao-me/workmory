import { KeyRound, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppHeader, AppHeaderContent, AppHeaderDescription } from "../../components/app/app-header";
import { ConfirmDialog } from "@/components/dialogs";
import { EmptyState } from "../../components/common";
import {
  ListItem,
  ListItemActions,
  ListItemBadges,
  ListItemContent,
  ListItemDescription,
  ListItemHeader,
  ListItemTitle,
} from "../../components/list-item";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardFrame, CardPanel } from "../../components/ui/card";
import { useApp } from "../../context/app-context";

export function CredentialsSettingsPage() {
  const { t } = useTranslation();
  const { hasApiKey, logout } = useApp();

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("settings.tabs.credentials")}>
          <AppHeaderDescription>
            {t("settings.credentials.description")}
          </AppHeaderDescription>
        </AppHeaderContent>
      </AppHeader>
      <section aria-label={t("settings.credentials.statusLabel")}>
        {hasApiKey ? (
          <CardFrame>
            <Card>
              <CardPanel className="p-0">
                <ListItem className="max-sm:[&>div]:flex-wrap">
                  <ListItemContent>
                    <ListItemHeader>
                      <ListItemTitle>
                        {t("settings.credentials.credentialLabel")}
                      </ListItemTitle>
                      <ListItemDescription>
                        <code aria-label={t("settings.credentials.maskedLabel")}>
                          ••••••••••••••••
                        </code>
                      </ListItemDescription>
                      <ListItemDescription>
                        {t("settings.credentials.warningDescription")}
                      </ListItemDescription>
                    </ListItemHeader>
                  </ListItemContent>
                  <ListItemBadges>
                    <Badge className="pointer-events-none" variant="success">
                      {t("settings.credentials.verified")}
                    </Badge>
                  </ListItemBadges>
                  <ListItemActions className="max-sm:w-full max-sm:justify-end">
                    <ConfirmDialog
                      confirmLabel={t("settings.credentials.clearConfirm")}
                      description={t("settings.credentials.clearDescription")}
                      destructive
                      onConfirm={logout}
                      title={t("settings.credentials.clearTitle")}
                      trigger={
                        <Button variant="destructive-outline">
                          <LogOut aria-hidden="true" />
                          {t("settings.credentials.logout")}
                        </Button>
                      }
                    />
                  </ListItemActions>
                </ListItem>
              </CardPanel>
            </Card>
          </CardFrame>
        ) : (
          <CardFrame>
            <Card>
              <CardPanel className="p-0">
                <EmptyState
                  description={t("settings.credentials.notSaved")}
                  icon={<KeyRound aria-hidden="true" />}
                  title={t("settings.credentials.title")}
                />
              </CardPanel>
            </Card>
          </CardFrame>
        )}
      </section>
    </>
  );
}
