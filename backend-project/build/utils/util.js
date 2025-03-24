"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResponseData = void 0;
/**
 * Helper function to generate consistent API responses.
 *
 * @param data - The payload to be returned (e.g., result, fetched data, null).
 * @param errMsg - Optional error message; if provided, marks the response as a failure.
 * @returns A Result object with `success`, optional `errMsg`, and `data`.
 *
 * This function helps ensure all responses follow the same format,
 * making it easier for front-end code to parse and handle results.
 */
var getResponseData = function (data, errMsg) {
    if (errMsg) {
        // Return failure response if an error message is provided
        return {
            success: false,
            errMsg: errMsg,
            data: data,
        };
    }
    // Otherwise, return a success response
    return {
        success: true,
        data: data,
    };
};
exports.getResponseData = getResponseData;
