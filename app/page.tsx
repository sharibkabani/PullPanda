import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<Image src="/logo.jpg" alt="PullPanda Logo" width={150} height={150} />
			<h1 className="mt-4 text-3xl font-bold">Welcome to PullPanda</h1>
			<Link href="/setup">
				<Button className="mt-4">Setup</Button>
			</Link>
		</div>
	);
}
