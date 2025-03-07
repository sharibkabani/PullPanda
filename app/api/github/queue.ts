import { model } from "./gemini";
import { Redis } from "@upstash/redis";

interface PRData {
	owner: string;
	repo: string;
	prNumber: number;
	sha: string;
}

// Initialize Redis client
const redis = new Redis({
	url: process.env.NEXT_PUBLIC_REDIS_URL,
	token: process.env.NEXT_PUBLIC_REDIS_TOKEN,
});

// Queue name constant
const QUEUE_NAME = "pr-review-queue";

/**
 * Simple Redis-based queue implementation
 */
class RedisQueue {
	private redis: Redis;
	private queueName: string;

	constructor(redis: Redis, queueName: string) {
		this.redis = redis;
		this.queueName = queueName;
	}

	/**
	 * Add a job to the queue
	 */
	async add(jobName: string, data: PRData) {
		const jobId = `${jobName}-${Date.now()}-${Math.random()
			.toString(36)
			.substring(2, 9)}`;
		await this.redis.set(jobId, JSON.stringify(data));
		await this.redis.lpush(this.queueName, jobId);
		console.log(`Added job to queue: ${jobId}`);
		return { id: jobId };
	}

	/**
	 * Process jobs from the queue
	 */
	async process(processor: (data: PRData) => Promise<void>) {
		console.log(`Starting processor for queue: ${this.queueName}`);

		// Worker loop
		while (true) {
			try {
				// Pop a job from the queue
				const jobId = await this.redis.rpop(this.queueName);

				if (jobId) {
					console.log(`Processing job: ${jobId}`);
					const jobData = await this.redis.get(jobId);

					if (jobData) {
						// Parse job data
						const data =
							typeof jobData === "string" ? JSON.parse(jobData) : jobData;

						// Process the job
						await processor(data);

						// Clean up
						await this.redis.del(jobId);
						console.log(`Job completed: ${jobId}`);
					} else {
						console.log(`No data found for job: ${jobId}`);
					}
				} else {
					// No jobs in queue, wait before checking again
					await new Promise((resolve) => setTimeout(resolve, 5000));
				}
			} catch (error) {
				console.error("Error processing job:", error);
				// Wait before trying again
				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
		}
	}
}

// Create queue instance
const prReviewQueue = new RedisQueue(redis, QUEUE_NAME);

/**
 * Process PR review jobs
 */
const processPRReview = async (prData: PRData) => {
	const { owner, repo, prNumber, sha } = prData;

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
};

// Start the worker in the background if we're in a Node.js environment
if (typeof process !== "undefined") {
	// Use setTimeout to ensure this runs after the module is fully loaded
	setTimeout(() => {
		prReviewQueue.process(processPRReview).catch((err) => {
			console.error("Failed to start worker:", err);
		});
	}, 1000);
}

export { prReviewQueue };
