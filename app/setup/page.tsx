import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";

export default function Setup() {
    return (
			<div className="min-h-screen bg-gradient-to-b from-gray-900 to-black py-12 px-4">
				<div className="max-w-3xl mx-auto">
					<h1 className="text-4xl font-bold text-white text-center mb-8 bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-500">
						Setup Your Repository
					</h1>

					<div className="space-y-6">
						{/* Public Repo Card */}
						<Card className="bg-gradient-to-br from-gray-900 to-black border border-gray-800 hover:border-blue-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/20 group">
							<CardHeader className="text-center relative overflow-hidden">
								<div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
								<CardTitle className="text-2xl font-semibold text-white tracking-wide">
									1. Set Repository to Public
								</CardTitle>
							</CardHeader>
							<CardContent className="text-center">
								<p className="text-gray-400 text-lg">
									Go to your repository settings and change it to public.
								</p>
							</CardContent>
						</Card>

						{/* Webhook Card */}
						<Card className="bg-gradient-to-br from-gray-900 to-black border border-gray-800 hover:border-blue-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/20 group">
							<CardHeader className="text-center relative overflow-hidden">
								<div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
								<CardTitle className="text-2xl font-semibold text-white tracking-wide">
									2. Add Webhook and Select JSON
								</CardTitle>
							</CardHeader>
							<CardContent className="text-center space-y-2">
								<p className="text-gray-400 text-lg">
									Go to the webhook settings and add
									pull-panda.vercel.app/api/github
								</p>
								<p className="text-gray-400 text-lg">
									Select application/json under content type.
								</p>
							</CardContent>
						</Card>

						{/* PR Event Card */}
						<Card className="bg-gradient-to-br from-gray-900 to-black border border-gray-800 hover:border-blue-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/20 group">
							<CardHeader className="text-center relative overflow-hidden">
								<div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
								<CardTitle className="text-2xl font-semibold text-white tracking-wide">
									3. Add Pull Request Event
								</CardTitle>
							</CardHeader>
							<CardContent className="text-center">
								<p className="text-gray-400 text-lg">
									Select the pull request event from the list of events.
								</p>
							</CardContent>
						</Card>
					</div>

					<Link href="/" className="block text-center mt-8">
						<Button className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-8 py-2 rounded-lg hover:shadow-lg hover:shadow-blue-500/30 transition-all duration-300 transform hover:scale-105">
							Back to Home
						</Button>
					</Link>
				</div>
			</div>
		);
}
