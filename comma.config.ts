// Projects: one per site or app that uses comma. Secrets come from env.
export default {
  projects: [
    {
      id: "example",
      // The example app, and a second site that signs in with the popup.
      origins: ["http://localhost:4100", "http://127.0.0.1:4100"],
      appSecret: process.env.EXAMPLE_APP_SECRET, // optional: enables app login
      signInUrl: "http://localhost:4100/comma-sign-in", // optional: enables popup sign-in
    },
  ],
}
