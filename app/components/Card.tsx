import Image from "next/image";
import React from "react";

interface CardProps {
	title: string;
	subtitle: string;
	imageUrl: string;
}

const Card: React.FC<CardProps> = ({ title, subtitle, imageUrl }) => {
	return (
		<div className="group relative overflow-hidden bg-gradient-to-br from-gray-900 to-black rounded-xl p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/20">
			{/* Subtle gradient overlay */}
			<div className="absolute inset-0 bg-gradient-to-t from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

			{/* Content container */}
			<div className="relative flex flex-col items-center space-y-6">
				{/* Image container with subtle border */}
				<div className="relative w-40 h-40 rounded-xl overflow-hidden ring-2 ring-gray-800 group-hover:ring-blue-500/50 transition-all duration-300">
					<Image
						src={imageUrl}
						alt={title}
						fill
						className="object-cover transition-transform duration-300 group-hover:scale-110"
						sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
					/>
				</div>

				{/* Text content */}
				<div className="text-center space-y-2">
					<h2 className="text-xl font-semibold text-white tracking-wide">
						{title}
					</h2>
					<p className="text-sm text-gray-400 leading-relaxed max-w-[250px]">
						{subtitle}
					</p>
				</div>

				{/* Optional: Add a subtle button or interaction hint */}
				<div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
			</div>
		</div>
	);
};

export default Card;
