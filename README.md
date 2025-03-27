## About The Project

PullPanda is an AI-powered code review assistant designed to help developers write better code and maintain high-quality standards. By integrating with GitHub pull requests, PullPanda provides automated feedback and suggestions, streamlining the code review process and improving overall code health.

### Key Features

- **AI-Powered Code Analysis:** Leverages Google's Gemini AI model to analyze code changes and identify potential issues.
- **Automated Pull Request Reviews:** Automatically reviews pull requests and posts comments with suggestions and feedback.
- **Real-time Feedback:** Provides instant feedback on code changes, helping developers address issues early in the development cycle.
- **Easy Setup:** Simple integration with GitHub repositories via webhooks.

## Architecture

The project is built using the following technologies:

- **Frontend:** Next.js, React, Tailwind CSS, Radix UI, Lucide React
- **Backend:** Next.js API routes, Google Gemini API, Upstash Redis, BullMQ
- **Queue:** Redis-based queue for processing pull request reviews

The frontend is a Next.js application that provides the user interface.  The backend consists of Next.js API routes that handle GitHub webhook events and interact with the Google Gemini API for code analysis.  Upstash Redis is used as a message queue to handle pull request review jobs.

## Getting Started

To set up PullPanda for your repository, follow these steps:

### Prerequisites

- A GitHub repository
- A Google Cloud project with the Gemini API enabled and an API key
- An Upstash Redis account with the URL and token
- Node.js and npm installed

### Installation

1.  **Set Repository to Public:** Go to your repository settings on GitHub and change the visibility to public.

2.  **Add Webhook:**
    - Go to your repository settings on GitHub and navigate to "Webhooks".
    - Click "Add webhook".
    - Set the "Payload URL" to `https://pull-panda.vercel.app/api/github`.
    - Set the "Content type" to `application/json`.

3.  **Select Pull Request Event:**
    - Under "Which events would you like to trigger this webhook?", select "Let me select individual events".
    - Check the box for "Pull requests".
    - Click "Add webhook" to save the webhook configuration.
