import { NextRequest, NextResponse } from "next/server";
import { prReviewQueue } from "./queue";

export const POST = async (req: NextRequest) => {
	// console.log("PR opened", req.body);
	const data = await req.json();

	if (data.action === "opened") {
		console.log("PR opened");
		const owner = data.repository.owner.login;
		const repo = data.repository.name;
		const prNumber = data.pull_request.number;
		const sha = data.pull_request.head.sha;

		// Add job to queue
		await prReviewQueue.add("review-pr", {
			owner,
			repo,
			prNumber,
			sha,
		});

		return NextResponse.json(
			{ message: "PR Review job queued successfully" },
			{ status: 200 }
		);
	} else {
		return new NextResponse("PR not opened", { status: 400 });
	}
};
