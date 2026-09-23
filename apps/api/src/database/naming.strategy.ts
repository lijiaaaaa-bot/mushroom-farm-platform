import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

function snake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/__/g, '_')
    .toLowerCase();
}

/** 表名在实体上显式指定；列名统一蛇形，方便报表 SQL。 */
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: string[],
  ): string {
    const name = customName || propertyName;
    return snake([...embeddedPrefixes, name].join('_'));
  }
}
