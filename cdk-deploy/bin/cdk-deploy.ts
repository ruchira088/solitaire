#!/usr/bin/env node
import { deployReactSpa } from "react-app-cdk-deploy"

deployReactSpa({
  stackName: "SolitaireFrontEndStack",
  domainName: "solitaire.ruchij.com",
  artifactBucket: "solitaire-bundles.ruchij.com"
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
