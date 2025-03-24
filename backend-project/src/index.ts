import express from "express";
import cookieSession from "cookie-session";
import "./controller/login-controller";
import "./controller/stock-data-controller";
import router from "./router";

// Create a new Express application
const app = express();
const port = 7001;

// Middleware to enable cookie-based sessions
app.use(
  cookieSession({
    name: "session", // Cookie name
    keys: ["author clu"], // Secret key(s) for encryption
    maxAge: 24 * 60 * 60 * 1000, // Cookie/session expiration time: 1 day
  })
);

// Use the router that contains all registered controller routes
app.use(router);

// Start the Express server on port 7001
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
