import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
	return (
		<div className="min-h-screen bg-gradient-to-b from-gray-900 to-black py-12 px-4">
			<div className="max-w-3xl mx-auto flex flex-col items-center justify-center">
				{/* Logo Container */}
				<div className="relative w-40 h-40 rounded-2xl overflow-hidden ring-2 ring-gray-800 hover:ring-blue-500/50 transition-all duration-300 group">
					<Image
						src="/logo.jpg"
						alt="PullPanda Logo"
						fill
						className="object-cover transition-transform duration-300 group-hover:scale-110"
						sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
					/>
					<div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
				</div>

				{/* Title with gradient text */}
				<h1 className="mt-8 text-4xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-500">
					Welcome to PullPanda
				</h1>

				{/* Description */}
				<p className="mt-4 text-gray-400 text-lg text-center max-w-md">
					Your AI-powered code review assistant that helps you write better code
					and maintain quality standards.
				</p>

				{/* Setup Button */}
				<Link href="/setup" className="mt-8">
					<Button className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-8 py-2 rounded-lg hover:shadow-lg hover:shadow-blue-500/30 transition-all duration-300 transform hover:scale-105">
						Get Started
					</Button>
				</Link>

				{/* Optional: Feature highlights */}
				<div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
					{[
						{
							title: "AI-Powered",
							description:
								"Advanced code analysis using cutting-edge AI technology",
						},
						{
							title: "Quick Setup",
							description:
								"Get started in minutes with simple repository integration",
						},
						{
							title: "Real-time Reviews",
							description: "Instant feedback on your pull requests",
						},
					].map((feature, index) => (
						<div
							key={index}
							className="bg-gradient-to-br from-gray-900 to-black border border-gray-800 rounded-xl p-6 hover:border-blue-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/20 group">
							<h3 className="text-xl font-semibold text-white mb-2">
								{feature.title}
							</h3>
							<p className="text-gray-400">{feature.description}</p>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
