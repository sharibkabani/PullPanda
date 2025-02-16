import Image from "next/image";

export default function Home() {
	return (
		<div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
			<Image src="/logo.jpg" alt="PullPanda Logo" width={150} height={150} />
      <h1 className="mt-4 text-3xl font-bold">Welcome to PullPanda</h1>
      <p className="mt-4 text-lg text-center">Frontend s00n.</p>
		</div>
	);
}
