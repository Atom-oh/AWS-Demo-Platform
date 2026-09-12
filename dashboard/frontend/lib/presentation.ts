import type { Status } from './types';

export const STATUS_LABEL: Record<Status, string> = {
  on: '실행 중', off: '중지됨', transitioning: '전환 중', error: '확인 필요', unknown: '상태 미확인',
};

export const RESOURCE_LABEL: Record<string, string> = {
  ecs: 'ECS', ec2: 'EC2', 'argocd-app': 'ArgoCD', rds: 'RDS', dynamodb: 'DynamoDB',
  elasticache: 'ElastiCache', kafka: 'Kafka', msk: 'MSK', stepfunctions: 'Step Functions',
  lambda: 'Lambda', firehose: 'Firehose',
};

// Mirrors @demo-platform/shared; the API remains the authoritative validator.
export const MAX_SCALE_COUNT = 20;
export const HPA_SCALE_NOTE =
  'HPA 자동 확장 범위를 입력한 수로 고정합니다. 원래 범위는 프로젝트를 끈 뒤 다시 켜면 복원됩니다.';
