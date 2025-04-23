# sssync_mobile_test

Mobile application for SSSync (React Native / Expo).

## Prerequisites

Before you begin, ensure you have the following installed:

*   **Node.js:** (LTS version recommended) - Download from [nodejs.org](https://nodejs.org/)
*   **npm** or **Yarn:** (Comes with Node.js or install separately)
*   **Git:** (For cloning the repository)
*   **Expo CLI:** Install globally via npm/yarn:
    ```bash
    npm install --global expo-cli
    # or
    yarn global add expo-cli
    ```
*   **Expo Go App:** Install on your physical iOS or Android device (available in App Store / Google Play) for easy testing.
*   **(Optional) Watchman:** (Recommended for macOS users) - `brew install watchman`
*   **(Optional) Xcode or Android Studio:** If you plan to build for simulators/emulators or create standalone builds.

## Setup Instructions

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url> # Replace with your actual repo URL
    cd sssync_mobile_test
    ```

2.  **Install Dependencies:**
    Using npm:
    ```bash
    npm install
    ```
    Or using Yarn:
    ```bash
    yarn install
    ```

3.  **Set Up Environment Variables:**
    *   Create a new file named `.env.local` in the root directory of the project.
    *   Add the following environment variables to the `.env.local` file, replacing the placeholder values with the actual credentials for your Supabase project:

        ```dotenv
        EXPO_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
        EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
        ```

    *   **Important:** Obtain these values from your Supabase project settings (Project Settings -> API). **Do not commit the `.env.local` file to Git.** It should be listed in your `.gitignore` file.

## Running the Application

1.  **Start the Development Server:**
    ```bash
    npx expo start
    ```
    This will start the Metro bundler and provide options to run the app.

2.  **Run on Device/Simulator:**
    *   **Using Expo Go (Recommended for quick testing):**
        *   Ensure the Expo Go app is installed on your physical device.
        *   Scan the QR code displayed by the Metro bundler using the Expo Go app.
        *   Your device must be on the same local network as your computer.
    *   **Using iOS Simulator:**
        *   Press `i` in the Metro bundler terminal (requires Xcode installed).
    *   **Using Android Emulator:**
        *   Press `a` in the Metro bundler terminal (requires Android Studio and a configured emulator).

## Development Notes

*   Ensure your Supabase instance has the correct database schema applied (see `sssync-db.md` or relevant migration files).
*   Check Supabase storage bucket policies if encountering issues with image uploads.
 
