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
  ],
}
