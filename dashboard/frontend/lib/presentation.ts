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
  'HPA 자동 확장 범위를 입력한 수로 고정합니다. 저장된 기준 범위는 프로젝트를 끈 뒤 다시 켜면 복원됩니다. 작업 실패 시 현재 범위를 확인하세요.';
export const HPA_SCALE_WARNING =
  'HPA 범위가 일부 변경되었을 수 있습니다. 저장된 기준이 없으면 원래 범위를 복원할 수 없으므로 ArgoCD에서 확인하세요.';
export const ECS_SCALE_NOTE = '변경한 수량이 이후 끄기·켜기의 복원 기준이 됩니다.';
