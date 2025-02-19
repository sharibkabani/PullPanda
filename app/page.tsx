import Image from "next/image";
import Link from "next/link";

export default function Home() {
	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<Image src="/logo.jpg" alt="PullPanda Logo" width={150} height={150} />
			<h1 className="mt-4 text-3xl font-bold">Welcome to PullPanda</h1>
			<p className="mt-4 text-lg text-center">s00n.</p>
			{/* link to /setup */}
			<Link href="/setup">
				<p className="mt-4 text-blue-500">Setup</p>
			</Link>
		</div>
	);
}
