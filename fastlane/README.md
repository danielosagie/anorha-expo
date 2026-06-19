fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios test_auth

```sh
[bundle exec] fastlane ios test_auth
```

Verify the ASC API key works (prints app + latest build)

### ios builds

```sh
[bundle exec] fastlane ios builds
```

List recent TestFlight builds. Usage: fastlane builds [limit:20]

### ios groups

```sh
[bundle exec] fastlane ios groups
```

List TestFlight (beta) groups

### ios testers

```sh
[bundle exec] fastlane ios testers
```

List TestFlight testers. Usage: fastlane testers [group:"Name"]

### ios whats_to_test

```sh
[bundle exec] fastlane ios whats_to_test
```

Set 'What to Test' on a build. Usage: fastlane whats_to_test text:"..." [build:56] [file:notes.txt] [locale:en-US]

### ios release_notes

```sh
[bundle exec] fastlane ios release_notes
```

Set App Store release notes (What's New). Usage: fastlane release_notes text:"..." [version:1.0.3] [locale:en-US]

### ios move_tester

```sh
[bundle exec] fastlane ios move_tester
```

Move a tester between TestFlight groups. Usage: fastlane move_tester email:a@b.com [from:"GroupA"] to:"GroupB"

### ios add_tester

```sh
[bundle exec] fastlane ios add_tester
```

Add a tester to a group. Usage: fastlane add_tester email:a@b.com group:"Name" [first:Jane] [last:Doe]

### ios expire_build

```sh
[bundle exec] fastlane ios expire_build
```

Expire build(s). Usage: fastlane expire_build build:54  |  fastlane expire_build keep_latest:true

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
