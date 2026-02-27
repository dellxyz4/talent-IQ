import { Buffer } from "buffer/";

const JUDGE0_API = "https://judge029.p.rapidapi.com";
const RAPIDAPI_KEY = import.meta.env.VITE_RAPIDAPI_KEY;

const LANGUAGE_MAP = {
  javascript: { id: 63, name: "JavaScript (Node.js 12.14.0)" },
  python: { id: 71, name: "Python (3.8.1)" },
  java: { id: 62, name: "Java (OpenJDK 13.0.1)" },
};

const encode = (str) => {
  return Buffer.from(str, "utf-8").toString("base64");
};

const decode = (str) => {
  return Buffer.from(str, "base64").toString("utf-8");
};

async function postSubmission(languageId, code) {
  try {
    const response = await fetch(
      `${JUDGE0_API}/submissions?base64_encoded=true&wait=false&fields=*`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-rapidapi-host": "judge029.p.rapidapi.com",
          "x-rapidapi-key": RAPIDAPI_KEY,
        },
        body: JSON.stringify({
          source_code: encode(code),
          language_id: languageId,
          // stdin: "",
        }),
      },
    );

    const data = await response.json();

    return data?.token;
  } catch (error) {
    return {
      success: false,
      error: `Failed to execute code: ${error.message}`,
    };
  }
}

async function getOutput(token) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let attempts = 0;
  const maxAttempts = 10;
  let waitTime = 1000;

  try {
    const url = `${JUDGE0_API}/submissions/${token}?base64_encoded=true&fields=*`;
    const options = {
      method: "GET",
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "judge029.p.rapidapi.com",
      },
    };

    while (attempts < maxAttempts) {
      const res = await fetch(url, options);
      const data = await res.json();
      if (data.status_id > 2) {
        console.log("get submission output final res: \n", data);
        return data; // ✅ Done
      }

      console.log("get submission output:\n", data.status);
      await delay(waitTime);
      waitTime = Math.min(waitTime * 2, 8000); // capping at 8s
      attempts++;
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to get output: ${error.message}`,
    };
  }
}

/**
 * Process Judge0 API response and return standardized result
 * Judge0 status IDs:
 *   1 = In Queue, 2 = Processing, 3 = Accepted (success),
 *   4 = Wrong Answer, 5 = Time Limit Exceeded, 6 = Compilation Error,
 *   7-12 = Various runtime errors, 13 = Internal Error, 14 = Exec Format Error
 */
function processJudge0Response(data) {
  const statusId = data.status_id;
  const stdout = decode(data.stdout) || "";
  const stderr = decode(data.stderr) || "";
  const compileOutput = decode(data.compile_output) || "";
  const message = decode(data.message) || "";

  // Status 3 = Accepted (successful execution)
  if (statusId === 3) {
    if (stderr) {
      // Code ran but produced stderr warnings
      return {
        success: true,
        output: stdout || "No output",
        error: stderr,
      };
    }
    return {
      success: true,
      output: stdout || "No output",
    };
  }

  // Status 6 = Compilation Error
  if (statusId === 6) {
    return {
      success: false,
      output: stdout,
      error: compileOutput || "Compilation error",
    };
  }

  // Status 5 = Time Limit Exceeded
  if (statusId === 5) {
    return {
      success: false,
      output: stdout,
      error: "Time Limit Exceeded - Your code took too long to execute.",
    };
  }

  // Status 7-12 = Runtime errors (SIGSEGV, SIGXFSZ, SIGFPE, SIGABRT, NZEC, Other)
  if (statusId >= 7 && statusId <= 12) {
    return {
      success: false,
      output: stdout,
      error:
        stderr ||
        message ||
        `Runtime Error (${data.status?.description || "Unknown"})`,
    };
  }

  // Status 13 = Internal Error
  if (statusId === 13) {
    return {
      success: false,
      error:
        "Internal Error - The judge encountered an issue. Please try again.",
    };
  }

  // Status 1 or 2 = Still processing (shouldn't happen with ?wait=true, but just in case)
  if (statusId === 1 || statusId === 2) {
    return {
      success: false,
      error: "Code execution is still processing. Please try again.",
    };
  }

  // Fallback for any unknown status
  return {
    success: false,
    output: stdout,
    error:
      stderr ||
      compileOutput ||
      message ||
      `Unexpected status: ${data.status?.description || statusId}`,
  };
}

export async function executeCode(language, code) {
  try {
    const langConfig = LANGUAGE_MAP[language];

    if (!langConfig) {
      return {
        success: false,
        error: `Unsupported language: ${language}`,
      };
    }

    if (!RAPIDAPI_KEY) {
      return {
        success: false,
        error:
          "RapidAPI key is not configured. Please set VITE_RAPIDAPI_KEY in your .env file.",
      };
    }

    const token = await postSubmission(langConfig.id, code);
    const output = await getOutput(token);
    return processJudge0Response(output);
  } catch (error) {
    return { success: false, error: error.message };
  }
}
