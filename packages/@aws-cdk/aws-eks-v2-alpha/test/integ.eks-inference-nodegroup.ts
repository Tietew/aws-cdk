/// !cdk-integ pragma:disable-update-workflow
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { App, Stack } from 'aws-cdk-lib';
import * as integ from '@aws-cdk/integ-tests-alpha';
import { getClusterVersionConfig } from './integ-tests-kubernetes-version';
import * as eks from '../lib';

class EksClusterInferenceStack extends Stack {

  constructor(scope: App, id: string) {
    super(scope, id);

    // just need one nat gateway to simplify the test
    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 1, restrictDefaultSecurityGroup: false });

    const cluster = new eks.Cluster(this, 'Cluster', {
      vpc,
      ...getClusterVersionConfig(this),
      albController: {
        version: eks.AlbControllerVersion.V2_6_2,
      },
    });

    cluster.addNodegroupCapacity('InferenceInstances', {
      instanceTypes: [new ec2.InstanceType('inf1.2xlarge')],
    });

    cluster.addNodegroupCapacity('Inference2Instances', {
      instanceTypes: [new ec2.InstanceType('inf2.xlarge')],
    });
  }
}

const app = new App();
const stack = new EksClusterInferenceStack(app, 'aws-cdk-eks-cluster-inference-nodegroup');
new integ.IntegTest(app, 'aws-cdk-eks-cluster-interence-nodegroup-integ', {
  testCases: [stack],
  // Test includes assets that are updated weekly. If not disabled, the upgrade PR will fail.
  diffAssets: false,
  cdkCommandOptions: {
    deploy: {
      args: {
        rollback: true,
      },
    },
  },
});
app.synth();
