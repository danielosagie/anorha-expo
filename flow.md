   graph TD
     A[App Starts] --> B{firstLaunch?}
     B -->|Yes| C[Show Onboarding]
     B -->|No| D{userToken?}
     D -->|Yes| E[Show Main App]
     D -->|No| F[Show Auth]