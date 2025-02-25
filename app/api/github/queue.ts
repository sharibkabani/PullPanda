import { Queue, Worker } from "bullmq";
import { model } from "./gemini";

interface PRData {
	owner: string;
	repo: string;
	prNumber: number;
	sha: string;
}

// Create a new queue
const prReviewQueue = new Queue<PRData>("pr-review-queue", {
	connection: {
		host: process.env.REDIS_HOST || "localhost",
		port: parseInt(process.env.REDIS_PORT || "6379"),
	},
});

// Create a worker
const worker = new Worker(
	"pr-review-queue",
	async (job) => {
		const { owner, repo, prNumber, sha } = job.data;

		try {
			// Get PR files
			const filesResponse = await fetch(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`,
				{
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${process.env.NEXT_PUBLIC_PULL_PANDA_GITHUB_TOKEN}`,
						"X-GitHub-Api-Version": "2022-11-28",
					},
				}
			);
			const files = await filesResponse.json();

			if (!Array.isArray(files)) {
				throw new Error(
					"Expected an array for files but got: " + JSON.stringify(files)
				);
			}

			// Fetch all file contents in parallel
			const filePromises = files.map(async (file) => {
				try {
					if (file.status === "removed") {
						return `\n\nFile: ${file.filename} (Deleted)`;
					}

					const fileContentResponse = await fetch(
						`https://api.github.com/repos/${owner}/${repo}/contents/${file.filename}?ref=${sha}`,
						{
							headers: {
								Accept: "application/vnd.github+json",
								Authorization: `Bearer ${process.env.NEXT_PUBLIC_PULL_PANDA_GITHUB_TOKEN}`,
								"X-GitHub-Api-Version": "2022-11-28",
							},
						}
					);

					if (!fileContentResponse.ok) {
						throw new Error(`Failed to fetch content for ${file.filename}`);
					}

					const fileContent = await fileContentResponse.json();
					return `\n\nFile: ${file.filename}\n\n${Buffer.from(
						fileContent.content,
						"base64"
					).toString("utf-8")}`;
				} catch (error) {
					console.error(`Error processing file ${file.filename}:`, error);
					return "";
				}
			});

			const codeContent = (await Promise.all(filePromises)).join("\n");
			const instructions = process.env.GEMINI_PROMPT;

			// Call AI model for code review
			const result = await model.generateContent({
				contents: [
					{
						role: "user",
						parts: [{ text: `${instructions}\n\n${codeContent}` }],
					},
				],
			});

			// Post review comment
			const response = result.response?.text?.();
			if (response) {
				await fetch(
					`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
					{
						method: "POST",
						headers: {
							Accept: "application/vnd.github+json",
							Authorization: `Bearer ${process.env.NEXT_PUBLIC_PULL_PANDA_GITHUB_TOKEN}`,
							"X-GitHub-Api-Version": "2022-11-28",
						},
						body: JSON.stringify({ body: response }),
					}
				);
			}
		} catch (error) {
			console.error("Error processing PR review:", error);
			throw error;
		}
	},
	{
		connection: {
			host: process.env.REDIS_HOST || "localhost",
			port: parseInt(process.env.REDIS_PORT || "6379"),
		},
	}
);

worker.on("error", (err: Error) => {
	console.error("Worker error:", err);
});

export { prReviewQueue };
