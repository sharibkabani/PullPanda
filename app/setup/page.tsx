import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";

export default function Setup() {
    return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					alignItems: "center",
					height: "100vh",
					margin: "0 auto",
					maxWidth: "600px", // Set a maximum width for the container
					width: "100%", // Ensure the container takes full width
				}}>
				<h1 className="text-3xl font-bold mb-4">Setup</h1>
				{/* public repo */}
				<Card className="bg-black text-white mb-4 w-full">
					<CardHeader style={{ textAlign: "center" }}>
						<CardTitle>1. Set Repository to Public.</CardTitle>
						<CardDescription></CardDescription>
					</CardHeader>
					<CardContent style={{ textAlign: "center" }}>
						<p>Go to your repository settings and change it to public.</p>
					</CardContent>
					<CardFooter></CardFooter>
				</Card>
				{/* add webhook and select json*/}
				<Card className="bg-black text-white mb-4 w-full">
					<CardHeader style={{ textAlign: "center" }}>
						<CardTitle>2. Add Webhook and Select JSON.</CardTitle>
						<CardDescription></CardDescription>
					</CardHeader>
					<CardContent style={{ textAlign: "center" }}>
						<p>
							Go to the webhook settings and add
							pull-panda.vercel.app/api/github.
						</p>
						<p>Select application/json under content type.</p>
					</CardContent>
					<CardFooter></CardFooter>
				</Card>

				{/* add pull request event */}
				<Card className="bg-black text-white mb-4 w-full">
					<CardHeader style={{ textAlign: "center" }}>
						<CardTitle>3. Add Pull Request Event.</CardTitle>
						<CardDescription></CardDescription>
					</CardHeader>
					<CardContent style={{ textAlign: "center" }}>
						<p>Select the pull request event from the list of events.</p>
					</CardContent>
					<CardFooter></CardFooter>
				</Card>

				<Link href="/">
					<Button className="mt-4">Home</Button>
				</Link>
			</div>
		);
}
