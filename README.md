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

# Example Response
<img width="453" alt="Screenshot 2025-04-15 at 7 13 38 PM" src="https://github.com/user-attachments/assets/ea08c6b1-5465-4711-a73c-4cfcdccd1fca" />




