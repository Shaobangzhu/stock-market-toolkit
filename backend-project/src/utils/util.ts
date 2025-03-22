// Define a standardized structure for API responses
interface Result {
  success: boolean; // Indicates whether the operation was successful
  errMsg?: string; // Optional error message (present only on failure)
  data: any; // The payload of the response (can be anything)
}

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
export const getResponseData = (data: any, errMsg?: string): Result => {
  if (errMsg) {
    // Return failure response if an error message is provided
    return {
      success: false,
      errMsg,
      data,
    };
  }
  // Otherwise, return a success response
  return {
    success: true,
    data,
  };
};
