program CircleArea;

function Ploshad(r: real): real;
begin
  Ploshad := 3.14 * r * r;
end;

var
  r, s: real;

begin
  writeln('Введите радиус круга:');
  readln(r);

  s := Ploshad(r);

  writeln('Площадь круга = ', s:0:2);
  readln;
end.
