import { Request } from "express";

// Extend the Express Request interface to type `body` as an object with optional string values
export interface RequestWithBody extends Request {
  body: {
    [key: string]: string | undefined;
  };
}