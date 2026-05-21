export type OperatorActionType =
  | "fix_code"
  | "update_env"
  | "rerun_workflow"
  | "request_human_action";

export interface OperatorRemediationAction {
  id: string;
  type: OperatorActionType;
  title: string;
  reason: string;
  targetFiles?: string[];
  probableFix?: string[];
  verification?: string[];
  approvalRequired: boolean;
}

export function getKnownRemediationActions(input: {
  service?: string;
  error?: string | null;
}): OperatorRemediationAction[] {
  const service = (input.service ?? "").toLowerCase();
  const error = input.error ?? "";
  const actions: OperatorRemediationAction[] = [];

  if (
    service.includes("app store connect") &&
    /PARAMETER_ERROR\.ILLEGAL|parameter 'sort'|sort.+can not be used/i.test(error)
  ) {
    actions.push({
      id: "app-store-connect-remove-forbidden-sort",
      type: "fix_code",
      title: "Remove unsupported App Store Connect sort parameter",
      reason: "Apple authenticated successfully but rejected Rune's read-only relationship query because `sort` is not allowed on that endpoint.",
      targetFiles: ["lib/app-store-connect-readonly.ts"],
      probableFix: [
        "Remove `sort` from `/builds` and `/appStoreVersions` relationship requests.",
        "Sort returned builds and versions locally by uploadedDate/createdDate.",
        "Add smoke coverage so the forbidden query parameter cannot return silently.",
      ],
      verification: [
        "npm run test:app-store-connect-readonly",
        "npm run build",
        "Live `/api/app-store-connect` returns ok=true after deployment.",
      ],
      approvalRequired: false,
    });
  }

  if (
    service.includes("app store connect") &&
    /401|NOT_AUTHORIZED|unauthorized|Could not read key|DECODER routines|private key/i.test(error)
  ) {
    actions.push({
      id: "app-store-connect-repair-credentials",
      type: "update_env",
      title: "Repair App Store Connect credentials",
      reason: "Rune cannot authenticate with Apple, usually because the .p8 key, key ID, or issuer ID is malformed or mismatched.",
      targetFiles: [],
      probableFix: [
        "Validate issuer ID, key ID, app ID, and .p8 private key formatting.",
        "Normalize the private key PEM before storing it in Vercel.",
        "Redeploy Rune so runtime env vars reload.",
      ],
      verification: [
        "Local Apple JWT request returns the configured app.",
        "Live `/api/app-store-connect` no longer returns 401.",
      ],
      approvalRequired: true,
    });
  }

  return actions;
}
