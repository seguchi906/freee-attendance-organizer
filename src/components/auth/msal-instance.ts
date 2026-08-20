import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "@/components/auth/auth-config";

export const msalInstance = new PublicClientApplication(msalConfig);
