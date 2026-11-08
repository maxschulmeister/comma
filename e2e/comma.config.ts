// Projects for the e2e tests (ports 4800 and 4900).
export default {
  projects: [
    {
      id: "example",
      name: "Example",
      origins: ["http://localhost:4900", "http://127.0.0.1:4900"],
      appSecret: "e2e-app-secret",
      signInUrl: "http://localhost:4900/comma-sign-in",
      guests: true,
      limits: { guestsPerHour: 10_000 }, // The tests make many guests.
    },
    // Details in a dialog. Test pages use it with `?project=dialog`.
    {
      id: "dialog",
      name: "Example",
      origins: ["http://localhost:4900", "http://127.0.0.1:4900"],
      guests: true,
      limits: { guestsPerHour: 10_000 },
      details: "dialog",
    },
    // The panel pushes the page by default. Test pages use it with `?project=push`.
    {
      id: "push",
      name: "Example",
      origins: ["http://localhost:4900", "http://127.0.0.1:4900"],
      guests: true,
      limits: { guestsPerHour: 10_000 },
      panel: "push",
    },
    // Members only: no guests, and visitors see no toolbar. Test pages use it with `?project=members`.
    {
      id: "members",
      name: "Example",
      origins: ["http://localhost:4900", "http://127.0.0.1:4900"],
      appSecret: "e2e-app-secret",
      signInUrl: "http://localhost:4900/comma-sign-in",
      toolbar: "signed-in",
    },
    // Sign-in through the app: the app page (/app) runs comma with identify(). Other sites open it in a popup.
    {
      id: "through-app",
      name: "Example",
      origins: ["http://localhost:4900", "http://127.0.0.1:4900"],
      appSecret: "e2e-app-secret",
      appUrl: "http://localhost:4900/app?project=through-app",
    },
    // Sign-in with the app's own requests (`data-token-from`): the test page sends tokens to /api/me, like an app.
    {
      id: "token-from",
      name: "Example",
      origins: ["http://localhost:4900", "http://127.0.0.1:4900"],
      userUrl: "http://localhost:4900/api/me",
      toolbar: "signed-in",
    },
    // Sign in with Slack only. The tests stop at Slack's sign-in page (a fake, see sign-in.spec.ts).
    {
      id: "slack",
      origins: ["http://localhost:4900", "http://127.0.0.1:4900"],
      slack: { clientId: "e2e-client", clientSecret: "e2e-secret", team: "T0E2E" },
      guests: false,
    },
  ],
}
