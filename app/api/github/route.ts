// filepath: /Users/zain/Desktop/PullPanda/client/app/api/github/route.ts
import { NextRequest, NextResponse } from "next/server";
import { model } from "./gemini";

interface GitHubFile {
    filename: string;
    status: string;
}

export const POST = async (req: NextRequest) => {
	// console.log("PR opened", req.body);
	const data = await req.json();

	if (data.action === "opened") {
		console.log("PR opened");
		const owner = data.repository.owner.login;
		const repo = data.repository.name;
		const prNumber = data.pull_request.number;
		const sha = data.pull_request.head.sha;

		// Respond immediately to avoid webhook timeout
		const response = NextResponse.json(
			{ message: "Processing PR Review" },
			{ status: 200 }
		);

		// Perform async processing AFTER responding to the webhook
		setTimeout(async () => {
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
					console.error("Expected an array for files but got:", files);
					return;
				}

				// Fetch all file contents in parallel
				const filePromises = (Array.isArray(files) ? files : []).map(
					async (file: GitHubFile) => {
						try {
							// Check if the file was deleted
							if (file.status === "removed") {
								console.log(`Skipping deleted file: ${file.filename}`);
								return `\n\nFile: ${file.filename} (Deleted)`;
							}

							// Fetch file content for added/modified files
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
							return ""; // Skip file on error
						}
					}
				);


				// Wait for all file contents to resolve
				const codeContent = (await Promise.all(filePromises)).join("\n");

				const instructions = process.env.GEMINI_PROMPT;

				// Call AI model for code review
				const result = await model.generateContent({
					contents: [
						{
							role: "user",
							parts: [
								{
									text: `${instructions}\n\n${codeContent}`,
								},
							],
						},
					],
				});

				// Extract and post review comment
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
			}
		}, 0); // Runs after response is sent

		return response;
	} else {
		return new NextResponse("PR not opened", { status: 400 });
	}
};
