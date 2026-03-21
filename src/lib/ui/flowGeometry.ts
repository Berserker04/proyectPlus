import { Position, type InternalNode, type Node, type XYPosition } from "@xyflow/react";

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingEdgeGeometry {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

function getNodeRect<NodeType extends Node>(node: InternalNode<NodeType>): NodeRect | null {
  const width = node.measured.width ?? node.width ?? node.initialWidth ?? 0;
  const height = node.measured.height ?? node.height ?? node.initialHeight ?? 0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width,
    height,
  };
}

function getRectCenter(rect: NodeRect): XYPosition {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function getRectIntersection(rect: NodeRect, target: XYPosition): XYPosition {
  const center = getRectCenter(rect);
  const halfWidth = Math.max(rect.width / 2, 1);
  const halfHeight = Math.max(rect.height / 2, 1);

  const normalizedX = (target.x - center.x) / (2 * halfWidth);
  const normalizedY = (target.y - center.y) / (2 * halfHeight);
  const xx = normalizedX - normalizedY;
  const yy = normalizedX + normalizedY;
  const magnitude = Math.abs(xx) + Math.abs(yy);

  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return center;
  }

  const scale = 1 / magnitude;
  const scaledX = scale * xx;
  const scaledY = scale * yy;

  return {
    x: halfWidth * (scaledX + scaledY) + center.x,
    y: halfHeight * (-scaledX + scaledY) + center.y,
  };
}

function getPositionForPoint(rect: NodeRect, point: XYPosition): Position {
  const distances: Array<[Position, number]> = [
    [Position.Left, Math.abs(point.x - rect.x)],
    [Position.Right, Math.abs(point.x - (rect.x + rect.width))],
    [Position.Top, Math.abs(point.y - rect.y)],
    [Position.Bottom, Math.abs(point.y - (rect.y + rect.height))],
  ];

  distances.sort((left, right) => left[1] - right[1]);

  return distances[0][0];
}

function getOppositePosition(position: Position): Position {
  switch (position) {
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    case Position.Top:
      return Position.Bottom;
    case Position.Bottom:
      return Position.Top;
    default:
      return Position.Top;
  }
}

export function getFloatingEdgeGeometry<NodeType extends Node>(
  sourceNode: InternalNode<NodeType>,
  targetNode: InternalNode<NodeType>,
): FloatingEdgeGeometry | null {
  const sourceRect = getNodeRect(sourceNode);
  const targetRect = getNodeRect(targetNode);

  if (!sourceRect || !targetRect) {
    return null;
  }

  const targetCenter = getRectCenter(targetRect);
  const sourceCenter = getRectCenter(sourceRect);
  const sourcePoint = getRectIntersection(sourceRect, targetCenter);
  const targetPoint = getRectIntersection(targetRect, sourceCenter);

  return {
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    sourcePosition: getPositionForPoint(sourceRect, sourcePoint),
    targetPosition: getPositionForPoint(targetRect, targetPoint),
  };
}

export function getPointerEdgeGeometry<NodeType extends Node>(
  sourceNode: InternalNode<NodeType>,
  pointer: XYPosition,
): FloatingEdgeGeometry | null {
  const sourceRect = getNodeRect(sourceNode);

  if (!sourceRect) {
    return null;
  }

  const sourcePoint = getRectIntersection(sourceRect, pointer);
  const sourcePosition = getPositionForPoint(sourceRect, sourcePoint);

  return {
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: pointer.x,
    targetY: pointer.y,
    sourcePosition,
    targetPosition: getOppositePosition(sourcePosition),
  };
}
