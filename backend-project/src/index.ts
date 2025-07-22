import express from "express";
import cookieSession from "cookie-session";
import "./controller/login-controller";
import "./controller/stock-data-controller";
import router from "./router";
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

// 在代码中引入dotenv的值, 这样， 任何process.env.XYZ的调用都可以自动读取.env中的值
dotenv.config();

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

// For parsing application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// Use the router that contains all registered controller routes
app.use(router);

// Start the Express server on port 7001
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
