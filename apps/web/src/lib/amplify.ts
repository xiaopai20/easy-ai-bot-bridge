"use client";

import { Amplify, type AuthConfig, type OAuthConfig, type ResourcesConfig } from "@aws-amplify/core";
import { fetchAuthSession, getCurrentUser, signInWithRedirect, signOut } from "@aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "@aws-amplify/auth/cognito";

if (typeof window !== "undefined") {
  const oauthScopes: OAuthConfig["scopes"] = ["openid", "email", "profile"];
  const oauthProviders: NonNullable<OAuthConfig["providers"]> = ["Google"];

  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "";
  const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "";
  const cognitoDomain = (process.env.NEXT_PUBLIC_COGNITO_DOMAIN || "").replace(/^https?:\/\//, "");
  const redirectSignIn = process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN || "http://localhost:3002/auth/callback";
  const redirectSignOut = process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT || "http://localhost:3002";

  if (userPoolId && userPoolClientId && cognitoDomain) {
    const amplifyConfig: ResourcesConfig = {
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId,
          loginWith: {
            oauth: {
              domain: cognitoDomain,
              scopes: oauthScopes,
              redirectSignIn: [redirectSignIn],
              redirectSignOut: [redirectSignOut],
              responseType: "code",
              providers: oauthProviders,
            },
          },
        },
      },
    };

    cognitoUserPoolsTokenProvider.setAuthConfig(amplifyConfig.Auth as AuthConfig);
    Amplify.configure(amplifyConfig, {
      Auth: {
        tokenProvider: cognitoUserPoolsTokenProvider,
      },
    });
  }
}

export { fetchAuthSession, getCurrentUser, signInWithRedirect, signOut };
