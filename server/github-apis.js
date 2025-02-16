require("dotenv").config();
const express = require("express");
const router = express.Router();
const { model } = require("./gemini");

router.use(express.json());

router.post("/webhook", async (req, res) => {
	const data = req.body;

	if (data.action === "opened") {
		console.log("PR opened");
		const owner = data.repository.owner.login;
		const repo = data.repository.name;
		const prNumber = data.pull_request.number;
		const sha = data.pull_request.head.sha;

		// **Respond immediately to avoid timeout**
		res.status(200).json({ message: "Processing PR review" });

		try {
			// Get PR files
			const filesResponse = await fetch(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`,
				{
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${process.env.PULL_PANDA_GITHUB_TOKEN}`,
						"X-GitHub-Api-Version": "2022-11-28",
					},
				}
			);
			const files = await filesResponse.json();

			// Fetch all file contents in parallel
			const filePromises = files.map(async (file) => {
				try {
					const fileContentResponse = await fetch(
						`https://api.github.com/repos/${owner}/${repo}/contents/${file.filename}?ref=${sha}`,
						{
							headers: {
								Accept: "application/vnd.github+json",
								Authorization: `Bearer ${process.env.PULL_PANDA_GITHUB_TOKEN}`,
								"X-GitHub-Api-Version": "2022-11-28",
							},
						}
					);
					const fileContent = await fileContentResponse.json();
					return `\n\nFile: ${file.filename}\n\n${Buffer.from(
						fileContent.content,
						"base64"
					).toString("utf-8")}`;
				} catch (error) {
					console.error(`Error fetching file ${file.filename}:`, error);
					return ""; // Skip file on error
				}
			});

			// Wait for all file contents to resolve
            const codeContent = (await Promise.all(filePromises)).join("\n");
            
            const instructions = process.env.GEMINI_PROMPT;

			// Call AI model for code review
			const result = await model.generateContent({
				contents: [
					{
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
							Authorization: `Bearer ${process.env.PULL_PANDA_GITHUB_TOKEN}`,
							"X-GitHub-Api-Version": "2022-11-28",
						},
						body: JSON.stringify({ body: response }),
					}
				);
			}
		} catch (error) {
			console.error("Error processing PR review:", error);
		}
	} else {
		// console.log(`PR ${data.action}`);
		res.status(200).json({ message: "No action taken" });
	}
});

module.exports = router;
